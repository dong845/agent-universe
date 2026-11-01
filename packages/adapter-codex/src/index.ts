// Codex rollouts → unified events. Formats: docs/log-formats.md; rules: docs/decisions.md.
import { posix } from "node:path";
import type { AgentTownEvent, Tokens, ToolFile } from "../../schema/src/event.ts";
import type { RoleMatcher } from "../../schema/src/roles.ts";
import { titleOf } from "../../schema/src/title.ts";
import { clip, countUnknown, hashId, readJsonl, toMs, type ReadStats } from "../../schema/src/util.ts";

const FACTION = "codex";

const SKIP_ITEMS = new Set(["message", "reasoning", "tool_search_call", "tool_search_output", "agent_message"]);
const SKIP_EVENTS = new Set([
  "agent_message", "agent_reasoning", "user_message", "item_completed", "thread_settings_applied",
  "patch_apply_end", "web_search_end", "mcp_tool_call_end", "image_generation_end", "exec_command_end",
  "agent_reasoning_raw_content", "exec_command_begin", "patch_apply_begin", "mcp_tool_call_begin",
  "web_search_begin", "image_generation_begin", "background_event", "stream_error", "plan_update",
  "thread_name_updated", "sub_agent_activity", "entered_review_mode", "exited_review_mode",
  "dynamic_tool_call_request", "dynamic_tool_call_response",
  // tokens spent before a rollback stay spent, so the rollback itself changes no totals
  "thread_rolled_back",
]);
const CALLS = new Set(["function_call", "custom_tool_call", "local_shell_call", "web_search_call", "image_generation_call"]);
const OUTPUTS = new Set(["function_call_output", "custom_tool_call_output", "local_shell_call_output"]);

export interface RolloutHead {
  path: string;
  id: string;
  parentId?: string;
  cwd?: string;
  agentType?: string;
  agentNickname?: string;
  firstTs: number;
}

/** The session_meta line of a rollout: enough to group parents and children without a full read. */
export function rolloutHead(path: string, stats: ReadStats): RolloutHead | undefined {
  for (const { rec } of readJsonl(path, stats)) {
    if (rec.type !== "session_meta") return undefined;
    const p = rec.payload ?? {};
    const sub = p.source?.subagent;
    const spawn = sub?.thread_spawn;
    return {
      path,
      id: p.id,
      parentId: p.parent_thread_id ?? spawn?.parent_thread_id,
      cwd: p.cwd,
      agentType: spawn ? spawn.agent_role ?? "subagent" : typeof sub?.other === "string" ? sub.other : undefined,
      agentNickname: spawn?.agent_nickname,
      firstTs: toMs(p.timestamp ?? rec.timestamp),
    };
  }
  return undefined;
}

function deltaTokens(last: Record<string, number>): Tokens {
  const cached = last.cached_input_tokens ?? 0;
  return {
    input: (last.input_tokens ?? 0) - cached, // cached is a subset of input (D3)
    output: last.output_tokens ?? 0,
    cacheRead: cached,
    cacheWrite: 0,
    reasoning: last.reasoning_output_tokens ?? 0,
  };
}

const PATCH_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

/** every file a patch names, untruncated; relative paths resolved against an absolute cwd */
export function patchFiles(text: unknown, cwd: string): ToolFile[] | undefined {
  if (typeof text !== "string" || !text.includes("*** ")) return undefined;
  // some shells pass the patch with its line breaks written out as "\n"; a patch with real line
  // breaks is read as it is, so a "\n" inside its content never starts a header
  const lines = text.includes("\n") ? text : text.replace(/\\n/g, "\n");
  const out: ToolFile[] = [];
  for (const m of lines.matchAll(PATCH_HEADER)) {
    let path = m[1].trim().replace(/\\?["'`]+$/, "");
    if (!path || path.length > 1024 || /[\u0000-\u001f]|\\n/.test(path)) continue;
    if (cwd.startsWith("/")) path = posix.resolve(cwd, path);
    out.push({ path, access: "edit" });
  }
  return out.length ? out : undefined;
}

function callTarget(p: Record<string, any>, cwd: string): { tool: string; target?: string; command?: string; files?: ToolFile[] } {
  const tool = p.name ?? p.type;
  if (p.type === "custom_tool_call") return { tool, target: clip(p.input, 80), command: typeof p.input === "string" ? p.input : undefined, files: patchFiles(p.input, cwd) };
  if (p.type === "local_shell_call") {
    const cmd = Array.isArray(p.action?.command) ? p.action.command.join(" ") : undefined;
    return { tool, target: clip(cmd, 80), command: cmd };
  }
  if (p.type === "web_search_call") return { tool, target: clip(p.action?.query, 120) };
  let args: any;
  try {
    args = JSON.parse(p.arguments ?? "{}");
  } catch {
    return { tool };
  }
  const cmd = typeof args.cmd === "string" ? args.cmd : Array.isArray(args.command) ? args.command.join(" ") : undefined;
  const patch = typeof args.input === "string" ? args.input : typeof args.patch === "string" ? args.patch : cmd;
  return { tool, target: clip(cmd ?? args.input ?? args.path ?? args.task_name ?? args.message, 80), command: cmd, files: patchFiles(patch, cwd) };
}

function exitStatus(output: unknown): "ok" | "error" {
  const s = typeof output === "string" ? output : JSON.stringify(output ?? "");
  const m = /(?:Process exited with code|Exit code:?)\s*(-?\d+)/.exec(s.slice(0, 400));
  return m && m[1] !== "0" ? "error" : "ok";
}

export interface CodexThreadResult {
  sessionId: string;
  events: AgentTownEvent[];
  /** Per rollout file: the final cumulative total_token_usage, for the probe cross-check (D5). */
  fileTotals: Map<string, Tokens>;
}

/**
 * One top-level thread and every descendant rollout (subagents, guardians) as one session (D1).
 * `heads[0]` must be the root; children follow in any order.
 */
export function parseCodexThread(heads: RolloutHead[], roles: RoleMatcher, stats: ReadStats): CodexThreadResult {
  const root = heads[0];
  const sessionId = root.id;
  const projectId = (root.cwd ?? "unknown").replace(/\/+$/, "");
  const events: AgentTownEvent[] = [];
  const fileTotals = new Map<string, Tokens>();
  // parent task timeline, used to place children (D6)
  const taskSpans: { taskId: string; start: number }[] = [];
  const spawnCalls: { callId: string; ts: number; agentId: string; taskId: string | null; childIds: string[] }[] = [];
  const children = heads.slice(1).sort((a, b) => a.firstTs - b.firstTs);
  // The parent task running at `ts`; a child created moments before the first task belongs to it.
  const taskAt = (ts: number): string | null =>
    ([...taskSpans].reverse().find((s) => s.start <= ts) ?? taskSpans[0])?.taskId ?? null;

  for (const h of [root, ...children]) {
    const isRoot = h === root;
    const agentId = isRoot ? "main" : h.id;
    const base = { faction: FACTION, sessionId, projectId, agentId } as const;
    let taskId: string | null = isRoot ? null : taskAt(h.firstTs);
    // A child's events are collected first and given their task once the spawn link is known.
    const out: AgentTownEvent[] = isRoot ? events : [];
    let model: string | undefined;
    let approval: string | undefined;
    let turnCwd: string | undefined = root.cwd;
    let openTask: AgentTownEvent | undefined;
    let prevTotal = "";
    let finalTotal: Tokens | undefined;
    const starts = new Map<string, number>();
    let firstTs = h.firstTs;
    let lastTs = h.firstTs;

    for (const { n, rec } of readJsonl(h.path, stats)) {
      const raw = { file: h.path, line: n };
      const ts = rec.timestamp ? toMs(rec.timestamp) : lastTs;
      lastTs = ts;
      const p = (rec.payload ?? {}) as Record<string, any>;
      const t = rec.type as string;

      if (t === "session_meta" || t === "world_state" || t === "token_usage_record" || t === "inter_agent_communication_metadata") continue;
      if (t === "turn_context") {
        model = p.model ?? model;
        if (typeof p.approval_policy === "string") approval = p.approval_policy;
        if (typeof p.cwd === "string") turnCwd = p.cwd;
        continue;
      }
      if (t === "compacted") continue; // the matching event_msg/context_compacted carries the event
      if (t === "event_msg") {
        const et = p.type;
        if (et === "task_started" && isRoot) {
          taskId = hashId(FACTION, sessionId, p.turn_id ?? String(n));
          taskSpans.push({ taskId, start: ts });
          openTask = { ...base, taskId, id: taskId, ts, kind: "task_start", trigger: "human", cwd: turnCwd, permissionMode: approval, raw };
          out.push(openTask);
        } else if ((et === "task_complete" || et === "turn_aborted") && isRoot && taskId) {
          out.push({ ...base, taskId, id: hashId(FACTION, taskId, "end"), ts, kind: "task_end", status: et === "turn_aborted" ? "error" : "ok", raw });
        } else if (et === "user_message" && isRoot && openTask && openTask.title === undefined) {
          // the task's title: the first user message inside it (spec 12.5)
          openTask.title = typeof p.message === "string" ? titleOf(p.message) : undefined;
        } else if (et === "token_count") {
          const info = p.info;
          if (!info) continue; // 33 such records carry no usage
          const key = JSON.stringify(info.total_token_usage);
          if (key === prevTotal) continue; // a repeated snapshot is not a new call
          prevTotal = key;
          const tot = info.total_token_usage ?? {};
          finalTotal = deltaTokens(tot);
          const d = deltaTokens(info.last_token_usage ?? {});
          out.push({
            ...base, taskId, id: hashId(FACTION, h.path, String(n)), ts, kind: "model_call",
            role: isRoot ? "commander" : roles.forAgent(h.agentType), model, tokens: d,
            contextUsed: info.last_token_usage?.input_tokens, contextMax: info.model_context_window, raw,
          });
        } else if (et === "error") {
          out.push({ ...base, taskId, id: hashId(FACTION, h.path, String(n)), ts, kind: "error", raw });
        } else if (et === "context_compacted") {
          out.push({ ...base, taskId, id: hashId(FACTION, h.path, String(n)), ts, kind: "compaction", raw });
        } else if (et === "task_started" || et === "task_complete" || et === "turn_aborted") {
          // a child's own turns are steps of that agent, not tasks of the session
        } else if (!SKIP_EVENTS.has(et)) {
          countUnknown(stats, `codex:event_msg/${et}`);
        }
        continue;
      }
      if (t === "response_item") {
        const it = p.type;
        if (CALLS.has(it)) {
          const callId = p.call_id ?? p.id ?? `${h.path}:${n}`;
          const { tool, target, command, files } = callTarget(p, projectId);
          starts.set(callId, ts);
          if (tool === "spawn_agent") spawnCalls.push({ callId, ts, agentId, taskId, childIds: [] });
          out.push({
            ...base, taskId, id: hashId(FACTION, h.id, callId, "start"), ts, kind: "tool_start", tool, toolUseId: callId, target, ...(files ? { files } : {}),
            role: roles.isDispatch(tool) ? "commander" : roles.forTool(tool, command), raw,
          });
          if (it === "web_search_call" || it === "image_generation_call") {
            // these carry their own result; there is no separate output item
            out.push({ ...base, taskId, id: hashId(FACTION, h.id, callId, "end"), ts, kind: "tool_end", toolUseId: callId, status: "ok", durationMs: 0, raw });
          }
        } else if (OUTPUTS.has(it)) {
          const started = starts.get(p.call_id);
          const output = p.output;
          if (started !== undefined) {
            const sc = spawnCalls.find((s) => s.callId === p.call_id);
            const m = sc && /"agent_id"\s*:\s*"([^"]+)"/.exec(typeof output === "string" ? output : JSON.stringify(output));
            if (sc && m) sc.childIds.push(m[1]);
          }
          out.push({
            ...base, taskId, id: hashId(FACTION, h.id, p.call_id, "end"), ts, kind: "tool_end", toolUseId: p.call_id,
            status: exitStatus(output), durationMs: started !== undefined ? ts - started : undefined, raw,
          });
        } else if (!SKIP_ITEMS.has(it)) {
          countUnknown(stats, `codex:response_item/${it}`);
        }
        continue;
      }
      countUnknown(stats, `codex:${t}`);
    }
    fileTotals.set(h.path, finalTotal ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

    if (!isRoot) {
      // D6: exact when a spawn_agent output named this child, else the latest spawn before it started
      let sc = spawnCalls.find((s) => s.childIds.includes(h.id));
      let link: "exact" | "inferred" | "none" = sc ? "exact" : "none";
      if (!sc && h.agentType !== "guardian") {
        sc = [...spawnCalls].reverse().find((s) => s.ts <= h.firstTs);
        if (sc) link = "inferred";
      }
      const parentAgentId = sc?.agentId ?? "main";
      // D6 + guardians: a spawned subagent's whole run counts against the task that spawned it; a
      // guardian is one long-lived reviewer, so each of its calls goes to the task running then.
      for (const ev of out) ev.taskId = h.agentType === "guardian" ? taskAt(ev.ts) : sc?.taskId ?? taskId;
      for (const ev of out) events.push(ev);
      events.push({
        ...base, taskId: sc?.taskId ?? taskId, kind: "agent_spawn", id: hashId(FACTION, h.id, "spawn"), ts: sc?.ts ?? firstTs,
        parentAgentId, spawnToolUseId: sc?.callId, spawnLink: link, agentType: h.agentType, agentTask: h.agentNickname,
        role: roles.forAgent(h.agentType), raw: { file: h.path, line: 1 },
      });
      events.push({ ...base, taskId: sc?.taskId ?? taskId, kind: "agent_return", id: hashId(FACTION, h.id, "return"), ts: lastTs, raw: { file: h.path, line: 0 } });
    }
  }

  events.sort((a, b) => a.ts - b.ts);
  return { sessionId, events, fileTotals };
}

/** Group rollout heads into threads: each root followed by all of its descendants. */
export function groupThreads(heads: RolloutHead[]): RolloutHead[][] {
  const byId = new Map(heads.map((h) => [h.id, h]));
  const rootOf = (h: RolloutHead): RolloutHead => {
    const seen = new Set<string>();
    let cur = h;
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId)!;
    }
    return cur;
  };
  const groups = new Map<string, RolloutHead[]>();
  for (const h of heads) {
    const r = rootOf(h);
    if (!groups.has(r.id)) groups.set(r.id, [r]);
    if (h !== r) groups.get(r.id)!.push(h);
  }
  return [...groups.values()];
}
