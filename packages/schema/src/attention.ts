// Which live sessions need the owner right now (spec 2026-11-01 A2). Pure: the server feeds it every
// event it holds, the hook signals it received, and the clock.
//
// The logs cannot say "waiting for your approval" while it happens: Claude writes the decision only
// after the owner made it. An open call that could need approval and has had no result for a while is
// therefore a guess ("maybe-waiting"); a hook, when the owner installed one, makes it exact.
import type { AgentTownEvent, AskQuestion, Faction } from "./event.ts";

export type AttentionState = "maybe-waiting" | "waiting" | "turn-done" | "error";

export interface HookSignal {
  /** `${faction}|${sessionId}` */
  session: string;
  event: string;
  ts: number;
  /** "permission": a Claude permission_prompt Notification or a Codex PermissionRequest; "idle": another notification */
  kind?: "permission" | "idle";
}

export interface Attention {
  session: string;
  faction: Faction;
  sessionId: string;
  projectId: string;
  requestId: string | null;
  state: AttentionState;
  since: number;
  tool?: string;
  exact: boolean;
  /** waiting on a question with options: its questions (spec 2026-11-05 D26 B1) */
  ask?: AskQuestion[];
}

export const ATTENTION = { waitMs: 20_000, errorSettleMs: 10_000, liveWindowMs: 600_000 };

/** tools that never ask for approval in the default modes */
export const NO_PROMPT_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "TodoWrite", "NotebookRead", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "ToolSearch"]);
/** subagent spawns run long by design; their own calls are watched instead */
export const SPAWN_TOOLS = new Set(["Agent", "Task", "spawn_agent"]);
/** tools `acceptEdits` approves by itself */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** permission modes in which nothing waits for the owner */
const NO_PROMPT_MODES = new Set(["bypassPermissions", "auto", "never"]);

const URGENCY: Record<AttentionState, number> = { waiting: 0, "maybe-waiting": 1, error: 2, "turn-done": 3 };

function canPrompt(tool: string | undefined, mode: string | undefined): boolean {
  if (!tool || NO_PROMPT_TOOLS.has(tool) || SPAWN_TOOLS.has(tool)) return false;
  if (mode && NO_PROMPT_MODES.has(mode)) return false;
  if (mode === "acceptEdits" && EDIT_TOOLS.has(tool)) return false;
  return true;
}

export function attentionOf(events: AgentTownEvent[], now: number, hooks: HookSignal[], requestOf: Map<string, string>, opts: Partial<typeof ATTENTION> = {}): Attention[] {
  const o = { ...ATTENTION, ...opts };
  const bySession = new Map<string, AgentTownEvent[]>();
  for (const e of events) {
    const k = `${e.faction}|${e.sessionId}`;
    const l = bySession.get(k);
    if (l) l.push(e);
    else bySession.set(k, [e]);
  }
  const lastHook = new Map<string, HookSignal>();
  for (const h of hooks) if (!lastHook.has(h.session) || lastHook.get(h.session)!.ts < h.ts) lastHook.set(h.session, h);

  const out: Attention[] = [];
  for (const [session, list] of bySession) {
    list.sort((a, b) => a.ts - b.ts);
    const last = list[list.length - 1];
    if (now - last.ts > o.liveWindowMs) continue;
    // the session's current turn: from its last main-agent task_start on
    let from = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === "task_start" && list[i].agentId === "main") { from = i; break; }
    const cur = from >= 0 ? list.slice(from) : list;
    const start = from >= 0 ? list[from] : undefined;
    const base = { session, faction: last.faction, sessionId: last.sessionId, projectId: start?.projectId ?? last.projectId, requestId: (last.taskId && requestOf.get(last.taskId)) ?? null };

    const hook = lastHook.get(session);
    if (hook && hook.ts >= last.ts && hook.kind === "permission") {
      const open = openCalls(cur).at(-1);
      out.push({ ...base, state: "waiting", since: hook.ts, tool: open?.tool, exact: true, ...(open?.ask ? { ask: open.ask } : {}) });
      continue;
    }
    // a question with options always waits for the owner, in any permission mode, from its first moment
    const question = openCalls(cur).filter((c) => c.tool === "AskUserQuestion").at(-1);
    if (question && last.kind !== "task_end") {
      out.push({ ...base, state: "waiting", since: question.ts, tool: question.tool, exact: true, ...(question.ask ? { ask: question.ask } : {}) });
      continue;
    }
    if (last.kind === "task_end") {
      out.push({ ...base, state: "turn-done", since: last.ts, exact: !!hook && hook.ts >= last.ts && hook.event === "Stop" });
      continue;
    }
    if (last.kind === "error") {
      if (now - last.ts >= o.errorSettleMs) out.push({ ...base, state: "error", since: last.ts, exact: false });
      continue;
    }
    const waiting = openCalls(cur).filter((c) => canPrompt(c.tool, start?.permissionMode) && now - c.ts >= o.waitMs);
    if (waiting.length) {
      const c = waiting[waiting.length - 1];
      out.push({ ...base, state: "maybe-waiting", since: c.ts, tool: c.tool, exact: false });
    }
  }
  return out.sort((a, b) => URGENCY[a.state] - URGENCY[b.state] || b.since - a.since);
}

/** tool calls started and not yet ended, oldest first */
function openCalls(list: AgentTownEvent[]): AgentTownEvent[] {
  const ended = new Set(list.filter((e) => e.kind === "tool_end" && e.toolUseId).map((e) => e.toolUseId));
  return list.filter((e) => e.kind === "tool_start" && !(e.toolUseId && ended.has(e.toolUseId)));
}
