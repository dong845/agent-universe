// Claude Code transcript → unified events. Formats: docs/log-formats.md; rules: docs/decisions.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AgentTownEvent, Tokens, ToolFile } from "../../schema/src/event.ts";
import type { RoleMatcher } from "../../schema/src/roles.ts";
import { titleOf } from "../../schema/src/title.ts";
import { clip, countUnknown, hashId, readJsonl, toMs, type ReadStats } from "../../schema/src/util.ts";

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

export function parseClaudeSession(mainPath: string, roles: RoleMatcher, stats: ReadStats): ClaudeSessionResult {
  const sessionId = basename(mainPath, ".jsonl");
  const files = sessionFiles(mainPath, stats);
  const events: AgentTownEvent[] = [];
  let projectId = dirname(mainPath);
  let projectFromCwd = false;

  // tool_use id → task, across files, so subagents land in the task that spawned them.
  const taskOfToolUse = new Map<string, string | null>();
  const tsOfToolUse = new Map<string, number>();
  const agentOfToolUse = new Map<string, string>();
  const workflowRunToolUse = new Map<string, string>();

  // Session-wide: a later agent file can open with a copy of an earlier agent's history (three
  // worktree agents here shared 49 message ids). The first file that holds a record owns it.
  const calls = new Map<string, AgentTownEvent>();
  const seen = new Set<string>();
  const push = (ev: AgentTownEvent) => {
    if (seen.has(ev.id)) return;
    seen.add(ev.id);
    events.push(ev);
  };

  let lastHumanTitle: string | undefined;
  // Main file first: it defines tasks. Subagent files only attach to them.
  for (const f of files) {
    const isMain = f.agentId === "main";
    const base = { faction: FACTION, sessionId, agentId: f.agentId } as const;
    let taskId: string | null = null;
    if (!isMain) {
      const spawnId = f.groupId ? workflowRunToolUse.get(f.groupId) : f.spawnToolUseId;
      taskId = (spawnId && taskOfToolUse.get(spawnId)) ?? null;
    }
    const toolStarts = new Map<string, number>();
    let firstTs: number | undefined;
    let lastTs: number | undefined;
    let mode: string | undefined;
    let cwd: string | undefined;

    for (const { n, rec } of readJsonl(f.path, stats)) {
      const raw = { file: f.path, line: n };
      if (rec.type === "permission-mode" && typeof rec.permissionMode === "string") mode = rec.permissionMode;
      if (typeof rec.cwd === "string") cwd = rec.cwd;
      if (!projectFromCwd && typeof rec.cwd === "string") {
        projectId = rec.cwd.replace(/\/+$/, "");
        projectFromCwd = true;
      }
      const ts = rec.timestamp !== undefined ? toMs(rec.timestamp) : lastTs;
      if (ts !== undefined) {
        firstTs ??= ts;
        lastTs = ts;
      }
      const type = rec.type as string;

      if (type === "assistant") {
        const msg = rec.message ?? {};
        if (rec.isApiErrorMessage) {
          push({ ...base, projectId, taskId, id: hashId(FACTION, raw.file, String(n)), ts: ts!, kind: "error", raw });
          continue;
        }
        const mid = msg.id ?? rec.uuid;
        if (msg.usage && msg.model !== "<synthetic>") {
          const t = usageTokens(msg.usage);
          const prev = calls.get(mid);
          if (!prev) {
            const ev: AgentTownEvent = {
              ...base, projectId, taskId, id: hashId(FACTION, mid), ts: ts!, kind: "model_call",
              role: isMain ? "commander" : roles.forAgent(f.agentType), model: msg.model, tokens: t,
              contextUsed: t.input + t.cacheRead + t.cacheWrite, provisional: true, raw,
            };
            calls.set(mid, ev);
            push(ev);
          } else if (t.output > prev.tokens!.output) {
            prev.tokens = t; // later lines of one message only grow output (log-formats Q4)
          }
        }
        for (const b of msg.content ?? []) {
          if (b?.type !== "tool_use" || seen.has(hashId(FACTION, b.id, "start"))) continue;
          const { target, command } = toolTarget(b.name, b.input);
          taskOfToolUse.set(b.id, taskId);
          tsOfToolUse.set(b.id, ts!);
          agentOfToolUse.set(b.id, f.agentId);
          toolStarts.set(b.id, ts!);
          push({
            ...base, projectId, taskId, id: hashId(FACTION, b.id, "start"), ts: ts!, kind: "tool_start",
            tool: b.name, toolUseId: b.id, target, ...(toolFiles(b.name, b.input) ? { files: toolFiles(b.name, b.input) } : {}),
            role: roles.isDispatch(b.name) ? "commander" : roles.forTool(b.name, command), raw,
          });
        }
        continue;
      }

      if (type === "user") {
        const content = rec.message?.content;
        if (isMain && opensTask(rec)) {
          if (taskId) push({ ...base, projectId, taskId, id: hashId(FACTION, taskId, "end"), ts: ts!, kind: "task_end", raw });
          taskId = hashId(FACTION, sessionId, rec.uuid);
          const title = titleOf(textOf(content));
          if (title) lastHumanTitle = title;
          push({ ...base, projectId, taskId, id: taskId, ts: ts!, kind: "task_start", trigger: "human", title, cwd, permissionMode: mode, raw });
          continue;
        }
        if (isMain && !taskId && !isToolResult(content) && textOf(content)) {
          taskId = hashId(FACTION, sessionId, rec.uuid);
          // a turn opened by something other than a prompt keeps working on the last human request
          const triggerBy = rec.isCompactSummary ? "compact" : rec.origin?.kind === "peer" ? "peer" : rec.isMeta ? "meta" : "other";
          push({ ...base, projectId, taskId, id: taskId, ts: ts!, kind: "task_start", trigger: "system", continues: lastHumanTitle, triggerBy, cwd, permissionMode: mode, raw });
        }
        if (rec.isCompactSummary) continue;
        const decision = rec.permissionDecision;
        if (decision && String(decision.source ?? "").startsWith("user")) {
          push({ ...base, projectId, taskId, id: hashId(FACTION, raw.file, String(n), "await"), ts: ts!, kind: "awaiting_user", raw });
        }
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (b?.type !== "tool_result") continue;
          const started = toolStarts.get(b.tool_use_id);
          const denied = rec.toolDenialKind || (decision && decision.decision && decision.decision !== "accept");
          const r = rec.toolUseResult;
          if (r && typeof r === "object" && typeof r.runId === "string") workflowRunToolUse.set(r.runId, b.tool_use_id);
          push({
            ...base, projectId, taskId, id: hashId(FACTION, b.tool_use_id, "end"), ts: ts!, kind: "tool_end",
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
            ...base, projectId, taskId, id: hashId(FACTION, rec.uuid), ts: ts!, kind: "compaction",
            compaction: { preTokens: m.preTokens, postTokens: m.postTokens, trigger: m.trigger }, raw,
          });
        } else if (rec.subtype === "turn_duration" && isMain && taskId) {
          push({ ...base, projectId, taskId, id: hashId(FACTION, taskId, "end"), ts: ts!, kind: "task_end", durationMs: rec.durationMs, raw });
          taskId = null;
        } else if (!SKIP_SYSTEM.has(rec.subtype)) {
          countUnknown(stats, `claude:system/${rec.subtype}`);
        }
        continue;
      }
      if (!SKIP.has(type)) countUnknown(stats, `claude:${type}`);
    }


    if (!isMain && firstTs !== undefined) {
      const spawnId = f.groupId ? workflowRunToolUse.get(f.groupId) : f.spawnToolUseId;
      const linked = spawnId !== undefined && tsOfToolUse.has(spawnId);
      const spawn: AgentTownEvent = {
        faction: FACTION, sessionId, projectId, taskId, agentId: f.agentId, kind: "agent_spawn",
        id: hashId(FACTION, sessionId, f.agentId, "spawn"), ts: linked ? tsOfToolUse.get(spawnId!)! : firstTs,
        parentAgentId: linked ? agentOfToolUse.get(spawnId!) : undefined, spawnToolUseId: spawnId,
        spawnLink: linked ? "exact" : "none", groupId: f.groupId, agentType: f.agentType ?? (f.groupId ? "workflow" : undefined),
        agentTask: f.agentTask, role: roles.forAgent(f.agentType), raw: { file: f.path, line: 1 },
      };
      push(spawn);
      push({
        faction: FACTION, sessionId, projectId, taskId, agentId: f.agentId, kind: "agent_return",
        id: hashId(FACTION, sessionId, f.agentId, "return"), ts: lastTs!, raw: { file: f.path, line: 0 },
      });
    }
    // A task still open at end of file is a live session, or one that stopped without a
    // turn_duration record; it stays open and the collector closes it when the next task starts.
  }

  const totals: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const ev of calls.values()) {
    ev.provisional = false; // every file has been read: the last line seen is final
    for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) totals[k] += ev.tokens![k];
  }
  for (const ev of events) ev.projectId = projectId;
  events.sort((a, b) => a.ts - b.ts);
  return { sessionId, events, totals };
}
