// Claude Code transcript → unified events. Formats: docs/log-formats.md; rules: docs/decisions.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AgentTownEvent, Tokens, ToolFile } from "../../schema/src/event.ts";
import { askQuestionsOf } from "../../schema/src/ask.ts";
import type { RoleMatcher } from "../../schema/src/roles.ts";
import { titleOf } from "../../schema/src/title.ts";
import { clip, countUnknown, hashId, headOf, readJsonl, readJsonlFrom, toMs, type Line, type ReadStats } from "../../schema/src/util.ts";

const FACTION = "claude-code";

// Bookkeeping records that carry nothing the town shows.
const SKIP = new Set([
  "attachment", "last-prompt", "mode", "permission-mode", "ai-title", "atis-latch", "queue-operation",
  "frame-link", "bridge-session", "api-request-blob", "api-request", "api-request-shape", "agent-name",
  "file-history-snapshot", "file-history-delta", "relocated", "worktree-state", "artifact-autoreact-ledger",
  "artifact-comment-monitor", "cost-state", "continued-in", "summary", "custom-title", "tag",
]);
const SKIP_SYSTEM = new Set(["stop_hook_summary", "away_summary", "informational", "scheduled_task_fire", "local_command"]);
const HUMAN_ORIGINS = new Set(["human"]);

interface AgentFile {
  path: string;
  agentId: string;
  agentType?: string;
  agentTask?: string;
  spawnToolUseId?: string;
  spawnDepth: number;
  groupId?: string;
}

/** The main transcript plus every subagent and workflow-agent file next to it. */
export function sessionFiles(mainPath: string, stats?: ReadStats): AgentFile[] {
  const files: AgentFile[] = [{ path: mainPath, agentId: "main", spawnDepth: 0 }];
  const subRoot = join(mainPath.slice(0, -".jsonl".length), "subagents");
  const walk = (dir: string, groupId?: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p, name.startsWith("wf_") ? name : groupId);
      } else if (name.startsWith("agent-") && name.endsWith(".jsonl")) {
        const metaPath = p.slice(0, -".jsonl".length) + ".meta.json";
        // a meta file can be half-written while its subagent starts: count it and go on without it
        let meta: Record<string, any> = {};
        try {
          if (existsSync(metaPath)) meta = JSON.parse(readFileSync(metaPath, "utf8"));
        } catch {
          if (stats) stats.badLines++;
        }
        files.push({
          path: p,
          agentId: name.slice("agent-".length, -".jsonl".length),
          agentType: meta.agentType,
          agentTask: clip(meta.description, 120),
          spawnToolUseId: meta.toolUseId,
          spawnDepth: meta.spawnDepth ?? 1,
          groupId,
        });
      }
    }
  };
  walk(subRoot);
  // A nested agent's spawn call lives in its parent agent's file, so parents are read first.
  return files.sort((a, b) => a.spawnDepth - b.spawnDepth);
}

function usageTokens(u: Record<string, any>): Tokens {
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

const READ_TOOLS = new Set(["Read"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** the files a call names exactly, untruncated */
function toolFiles(name: string, input: Record<string, any> | undefined): ToolFile[] | undefined {
  const p = input?.file_path ?? input?.notebook_path;
  if (typeof p !== "string" || !p) return undefined;
  if (READ_TOOLS.has(name)) return [{ path: p, access: "read" }];
  if (EDIT_TOOLS.has(name)) return [{ path: p, access: "edit" }];
  return undefined;
}

/** the questions of an AskUserQuestion call, kept as logged */
const askOf = (name: string, input: Record<string, any> | undefined) => (name === "AskUserQuestion" ? askQuestionsOf(input) : undefined);

function toolTarget(name: string, input: Record<string, any> | undefined): { target?: string; command?: string } {
  if (!input) return {};
  if (name === "Skill" && typeof input.skill === "string") return { target: clip(input.skill, 120) };
  if (typeof input.command === "string") return { target: clip(input.command, 80), command: input.command };
  const t = input.file_path ?? input.notebook_path ?? input.path ?? input.url ?? input.pattern ?? input.query;
  return { target: clip(t, 120) };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text").map((b) => b.text ?? "").join(" ");
}

function isToolResult(content: unknown): boolean {
  return Array.isArray(content) && content.some((b) => b?.type === "tool_result");
}

/**
 * Whether a user line opens a new task (D2). Older lines have no `origin`; there a typed slash
 * command counts, while local command output and interruption markers do not.
 */
function opensTask(rec: Record<string, any>): boolean {
  if (rec.isMeta || rec.isCompactSummary) return false;
  const content = rec.message?.content;
  if (isToolResult(content)) return false;
  const kind = rec.origin?.kind;
  if (kind) return HUMAN_ORIGINS.has(kind);
  const text = textOf(content).trimStart();
  if (!text) return false;
  if (text.startsWith("<local-command") || text.startsWith("[Request interrupted")) return false;
  return !text.startsWith("<");
}

export interface ClaudeSessionResult {
  sessionId: string;
  events: AgentTownEvent[];
  /** Deduped token sum over every agent file, for the probe cross-check (D5). */
  totals: Tokens;
}

interface FileState {
  file: AgentFile;
  taskId: string | null;
  toolStarts: Map<string, number>;
  firstTs?: number;
  lastTs?: number;
  mode?: string;
  cwd?: string;
}

/** where an event came from, for one total order that does not depend on how the files were fed */
interface Origin { path: string; line: number; k: number }

/**
 * One Claude session parsed line by line (spec 2026-11-03 A1). A full parse feeds every file whole; a
 * live session is fed only the lines that were appended since. `finish()` builds the result on top of
 * the state without changing it, so feeding can go on afterwards. The result is the same however the
 * lines were split, as long as each round feeds the main file first (parents before children).
 */
export class ClaudeSessionParser {
  readonly sessionId: string;
  private events: AgentTownEvent[] = [];
  private origin = new WeakMap<AgentTownEvent, Origin>();
  private projectId: string;
  private projectFromCwd = false;
  // tool_use id → task, across files, so subagents land in the task that spawned them.
  private taskOfToolUse = new Map<string, string | null>();
  private tsOfToolUse = new Map<string, number>();
  private agentOfToolUse = new Map<string, string>();
  private workflowRunToolUse = new Map<string, string>();
  // Session-wide: a later agent file can open with a copy of an earlier agent's history (three
  // worktree agents here shared 49 message ids). The first file that holds a record owns it.
  private calls = new Map<string, AgentTownEvent>();
  private seen = new Set<string>();
  private lastHumanTitle: string | undefined;
  private files = new Map<string, FileState>();
  // plain fields: the server runs this file through node's type stripping (no parameter properties)
  private roles: RoleMatcher;
  private stats: ReadStats;

  constructor(mainPath: string, roles: RoleMatcher, stats: ReadStats) {
    this.roles = roles;
    this.stats = stats;
    this.sessionId = basename(mainPath, ".jsonl");
    this.projectId = dirname(mainPath);
  }

  /** the subagent's task as the state stands now (a workflow's run id arrives with its tool result) */
  private spawnTaskOf(f: AgentFile): string | null {
    const spawnId = f.groupId ? this.workflowRunToolUse.get(f.groupId) : f.spawnToolUseId;
    return (spawnId && this.taskOfToolUse.get(spawnId)) ?? null;
  }

  /**
   * A subagent that was first fed before its spawn could be resolved, and can be now: a full parse
   * would have given it a task, so the caller parses again from the start.
   */
  get stale(): boolean {
    for (const st of this.files.values()) if (st.file.agentId !== "main" && st.taskId === null && this.spawnTaskOf(st.file) !== null) return true;
    return false;
  }

  feed(f: AgentFile, lines: Iterable<Line>): void {
    const { roles, stats, sessionId } = this;
    const isMain = f.agentId === "main";
    let st = this.files.get(f.path);
    if (!st) {
      st = { file: f, taskId: isMain ? null : this.spawnTaskOf(f), toolStarts: new Map() };
      this.files.set(f.path, st);
    }
    const base = { faction: FACTION, sessionId, agentId: f.agentId } as const;
    for (const { n, rec } of lines) {
      const raw = { file: f.path, line: n };
      let k = 0;
      const push = (ev: AgentTownEvent) => {
        if (this.seen.has(ev.id)) return;
        this.seen.add(ev.id);
        this.events.push(ev);
        this.origin.set(ev, { path: f.path, line: n, k: k++ });
      };
      const projectId = () => this.projectId;
      if (rec.type === "permission-mode" && typeof rec.permissionMode === "string") st.mode = rec.permissionMode;
      if (typeof rec.cwd === "string") st.cwd = rec.cwd;
      if (!this.projectFromCwd && typeof rec.cwd === "string") {
        this.projectId = rec.cwd.replace(/\/+$/, "");
        this.projectFromCwd = true;
      }
      const ts = rec.timestamp !== undefined ? toMs(rec.timestamp) : st.lastTs;
      if (ts !== undefined) {
        st.firstTs ??= ts;
        st.lastTs = ts;
      }
      const type = rec.type as string;
      const taskId = st.taskId;

      if (type === "assistant") {
        const msg = rec.message ?? {};
        if (rec.isApiErrorMessage) {
          push({ ...base, projectId: projectId(), taskId, id: hashId(FACTION, raw.file, String(n)), ts: ts!, kind: "error", raw });
          continue;
        }
        const mid = msg.id ?? rec.uuid;
        if (msg.usage && msg.model !== "<synthetic>") {
          const t = usageTokens(msg.usage);
          const prev = this.calls.get(mid);
          if (!prev) {
            const ev: AgentTownEvent = {
              ...base, projectId: projectId(), taskId, id: hashId(FACTION, mid), ts: ts!, kind: "model_call",
              role: isMain ? "commander" : roles.forAgent(f.agentType), model: msg.model, tokens: t,
              contextUsed: t.input + t.cacheRead + t.cacheWrite, provisional: true, raw,
            };
            this.calls.set(mid, ev);
            push(ev);
          } else if (t.output > prev.tokens!.output) {
            prev.tokens = t; // later lines of one message only grow output (log-formats Q4)
          }
        }
        for (const b of msg.content ?? []) {
          if (b?.type !== "tool_use" || this.seen.has(hashId(FACTION, b.id, "start"))) continue;
          const { target, command } = toolTarget(b.name, b.input);
          this.taskOfToolUse.set(b.id, taskId);
          this.tsOfToolUse.set(b.id, ts!);
          this.agentOfToolUse.set(b.id, f.agentId);
          st.toolStarts.set(b.id, ts!);
          push({
            ...base, projectId: projectId(), taskId, id: hashId(FACTION, b.id, "start"), ts: ts!, kind: "tool_start",
            tool: b.name, toolUseId: b.id, target, ...(toolFiles(b.name, b.input) ? { files: toolFiles(b.name, b.input) } : {}), ...(askOf(b.name, b.input) ? { ask: askOf(b.name, b.input) } : {}),
            role: roles.isDispatch(b.name) ? "commander" : roles.forTool(b.name, command), raw,
          });
        }
        continue;
      }

      if (type === "user") {
        const content = rec.message?.content;
        if (isMain && opensTask(rec)) {
          if (st.taskId) push({ ...base, projectId: projectId(), taskId: st.taskId, id: hashId(FACTION, st.taskId, "end"), ts: ts!, kind: "task_end", raw });
          st.taskId = hashId(FACTION, sessionId, rec.uuid);
          const title = titleOf(textOf(content));
          if (title) this.lastHumanTitle = title;
          push({ ...base, projectId: projectId(), taskId: st.taskId, id: st.taskId, ts: ts!, kind: "task_start", trigger: "human", title, cwd: st.cwd, permissionMode: st.mode, raw });
          continue;
        }
        if (isMain && !st.taskId && !isToolResult(content) && textOf(content)) {
          st.taskId = hashId(FACTION, sessionId, rec.uuid);
          // a turn opened by something other than a prompt keeps working on the last human request
          const triggerBy = rec.isCompactSummary ? "compact" : rec.origin?.kind === "peer" ? "peer" : rec.isMeta ? "meta" : "other";
          push({ ...base, projectId: projectId(), taskId: st.taskId, id: st.taskId, ts: ts!, kind: "task_start", trigger: "system", continues: this.lastHumanTitle, triggerBy, cwd: st.cwd, permissionMode: st.mode, raw });
        }
        if (rec.isCompactSummary) continue;
        const decision = rec.permissionDecision;
        if (decision && String(decision.source ?? "").startsWith("user")) {
          push({ ...base, projectId: projectId(), taskId: st.taskId, id: hashId(FACTION, raw.file, String(n), "await"), ts: ts!, kind: "awaiting_user", raw });
        }
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (b?.type !== "tool_result") continue;
          const started = st.toolStarts.get(b.tool_use_id);
          const denied = rec.toolDenialKind || (decision && decision.decision && decision.decision !== "accept");
          const r = rec.toolUseResult;
          if (r && typeof r === "object" && typeof r.runId === "string") this.workflowRunToolUse.set(r.runId, b.tool_use_id);
          push({
            ...base, projectId: projectId(), taskId: st.taskId, id: hashId(FACTION, b.tool_use_id, "end"), ts: ts!, kind: "tool_end",
            toolUseId: b.tool_use_id, status: denied ? "denied" : b.is_error ? "error" : "ok",
            durationMs: started !== undefined && ts !== undefined ? ts - started : undefined, raw,
          });
        }
        continue;
      }

      if (type === "system") {
        if (rec.subtype === "compact_boundary") {
          const m = rec.compactMetadata ?? {};
          push({
            ...base, projectId: projectId(), taskId, id: hashId(FACTION, rec.uuid), ts: ts!, kind: "compaction",
            compaction: { preTokens: m.preTokens, postTokens: m.postTokens, trigger: m.trigger }, raw,
          });
        } else if (rec.subtype === "turn_duration" && isMain && st.taskId) {
          push({ ...base, projectId: projectId(), taskId: st.taskId, id: hashId(FACTION, st.taskId, "end"), ts: ts!, kind: "task_end", durationMs: rec.durationMs, raw });
          st.taskId = null;
        } else if (!SKIP_SYSTEM.has(rec.subtype)) {
          countUnknown(stats, `claude:system/${rec.subtype}`);
        }
        continue;
      }
      if (!SKIP.has(type)) countUnknown(stats, `claude:${type}`);
    }
  }

  /** the session as it stands: the state is not changed, so feeding can continue afterwards */
  finish(order: AgentFile[]): ClaudeSessionResult {
    const { sessionId, roles } = this;
    const out = [...this.events];
    const origin = new Map<AgentTownEvent, Origin>();
    for (const ev of out) origin.set(ev, this.origin.get(ev)!);
    for (const st of this.files.values()) {
      const f = st.file;
      if (f.agentId === "main" || st.firstTs === undefined) continue;
      const spawnId = f.groupId ? this.workflowRunToolUse.get(f.groupId) : f.spawnToolUseId;
      const linked = spawnId !== undefined && this.tsOfToolUse.has(spawnId);
      const spawn: AgentTownEvent = {
        faction: FACTION, sessionId, projectId: this.projectId, taskId: st.taskId, agentId: f.agentId, kind: "agent_spawn",
        id: hashId(FACTION, sessionId, f.agentId, "spawn"), ts: linked ? this.tsOfToolUse.get(spawnId!)! : st.firstTs,
        parentAgentId: linked ? this.agentOfToolUse.get(spawnId!) : undefined, spawnToolUseId: spawnId,
        spawnLink: linked ? "exact" : "none", groupId: f.groupId, agentType: f.agentType ?? (f.groupId ? "workflow" : undefined),
        agentTask: f.agentTask, role: roles.forAgent(f.agentType), raw: { file: f.path, line: 1 },
      };
      const ret: AgentTownEvent = {
        faction: FACTION, sessionId, projectId: this.projectId, taskId: st.taskId, agentId: f.agentId, kind: "agent_return",
        id: hashId(FACTION, sessionId, f.agentId, "return"), ts: st.lastTs!, raw: { file: f.path, line: 0 },
      };
      for (const [ev, k] of [[spawn, 0], [ret, 1]] as const) {
        if (this.seen.has(ev.id)) continue;
        out.push(ev);
        origin.set(ev, { path: f.path, line: Number.MAX_SAFE_INTEGER, k });
      }
      // A task still open at end of file is a live session, or one that stopped without a
      // turn_duration record; it stays open and the collector closes it when the next task starts.
    }
    const totals: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const ev of this.calls.values()) {
      ev.provisional = false; // every line read so far has been seen: the last one is the value
      for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) totals[key] += ev.tokens![key];
    }
    for (const ev of out) ev.projectId = this.projectId;
    // one total order — time, then the session's file order, line, place in the line — so the result
    // does not depend on how the files' lines were interleaved when fed
    const fileIdx = new Map(order.map((f, i) => [f.path, i]));
    out.sort((a, b) => {
      const oa = origin.get(a)!, ob = origin.get(b)!;
      return a.ts - b.ts || (fileIdx.get(oa.path) ?? 0) - (fileIdx.get(ob.path) ?? 0) || oa.line - ob.line || oa.k - ob.k;
    });
    return { sessionId, events: out, totals };
  }
}

export function parseClaudeSession(mainPath: string, roles: RoleMatcher, stats: ReadStats): ClaudeSessionResult {
  const files = sessionFiles(mainPath, stats);
  const p = new ClaudeSessionParser(mainPath, roles, stats);
  // Main file first: it defines tasks. Subagent files only attach to them.
  for (const f of files) p.feed(f, readJsonl(f.path, stats));
  return p.finish(files);
}

interface Tail { offset: number; lineNo: number; head: string; meta: string }
const metaOf = (f: AgentFile) => JSON.stringify([f.agentType, f.agentTask, f.spawnToolUseId, f.spawnDepth, f.groupId]);

/**
 * A live Claude session read as it grows (spec 2026-11-03 A1): each update feeds only the complete lines
 * appended since the last one. A file that shrank or was replaced, a subagent whose meta file changed,
 * or a subagent fed before its spawn could be resolved makes it parse again from the start.
 */
export class ClaudeLive {
  private parser: ClaudeSessionParser | null = null;
  private tails = new Map<string, Tail>();
  private mainPath: string;
  private roles: RoleMatcher;
  constructor(mainPath: string, roles: RoleMatcher) {
    this.mainPath = mainPath;
    this.roles = roles;
  }

  update(stats: ReadStats): ClaudeSessionResult & { mode: "full" | "tail"; pending: boolean } {
    const files = sessionFiles(this.mainPath, stats);
    let mode: "full" | "tail" = "tail";
    if (!this.parser || this.parser.stale || !this.canTail(files)) {
      this.parser = new ClaudeSessionParser(this.mainPath, this.roles, stats);
      this.tails.clear();
      mode = "full";
    }
    let pending = false;
    for (const f of files) {
      const t = this.tails.get(f.path) ?? { offset: 0, lineNo: 0, head: "", meta: metaOf(f) };
      const r = readJsonlFrom(f.path, t.offset, t.lineNo, stats);
      pending ||= r.pending;
      this.parser.feed(f, r.lines);
      this.tails.set(f.path, { offset: r.offset, lineNo: r.lineNo, head: r.offset ? headOf(f.path) : "", meta: metaOf(f) });
    }
    if (mode === "tail" && this.parser.stale) return this.update(stats);
    return { ...this.parser.finish(files), mode, pending };
  }

  private canTail(files: AgentFile[]): boolean {
    const now = new Map(files.map((f) => [f.path, f]));
    for (const [path, t] of this.tails) {
      const f = now.get(path);
      if (!f || metaOf(f) !== t.meta) return false;
      try {
        if (statSync(path).size < t.offset) return false;
        if (t.offset && headOf(path) !== t.head) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}
