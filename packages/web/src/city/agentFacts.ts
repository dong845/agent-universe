// What a followed agent is doing (spec 2026-11-05 C1), worked out on the page from the town's events:
// its open tool call, for how long, its tokens so far, the subagents it has sent, its parent.
import type { AgentTownEvent, Role } from "../../../schema/src/event.ts";

export interface AgentFacts {
  kind: "main" | "sub";
  agentType?: string;
  /** the task it was given (a subagent's prompt line); share mode shows it only with titles on */
  task?: string;
  /** its open tool call at `t`; `target` (a file or command) never in share mode */
  doing: { role: Role; tool?: string; target?: string } | null;
  /** how long it has been doing that (or, with nothing open, since its last event) */
  sinceMs: number;
  /** input + output + cache read + cache write of its model calls up to `t` */
  tokens: number;
  /** the subagents it has sent out by `t`, in order */
  children: string[];
  parent?: string;
}

/** the agent id inside a robot id: `live|<id>`, `rp|<id>`, `hist|<id>|<i>` */
export function agentIdOf(robotId: string): string {
  const parts = robotId.split("|");
  if (parts[0] === "hist") return parts.slice(1, -1).join("|");
  return parts.slice(1).join("|");
}

export function agentFacts(events: readonly AgentTownEvent[], agentId: string, t: number, opts: { share: boolean; titles: boolean }): AgentFacts {
  let spawn: AgentTownEvent | undefined;
  let seen = false;
  let last = -Infinity;
  let tokens = 0;
  const children: string[] = [];
  const open = new Map<string, AgentTownEvent>();
  for (const e of events) {
    if (e.ts > t) continue;
    if (e.kind === "agent_spawn" && e.parentAgentId === agentId && !children.includes(e.agentId)) children.push(e.agentId);
    if (e.agentId !== agentId) continue;
    seen = true;
    last = Math.max(last, e.ts);
    if (e.kind === "agent_spawn" && !spawn) spawn = e;
    else if (e.kind === "model_call" && e.tokens) tokens += e.tokens.input + e.tokens.output + e.tokens.cacheRead + e.tokens.cacheWrite;
    else if (e.kind === "tool_start") open.set(e.toolUseId ?? e.id, e);
    else if (e.kind === "tool_end" && e.toolUseId) open.delete(e.toolUseId);
  }
  if (!seen) return { kind: "sub", doing: null, sinceMs: 0, tokens: 0, children };
  let now: AgentTownEvent | undefined;
  for (const e of open.values()) if (!now || e.ts >= now.ts) now = e;
  const doing = now ? { role: now.role ?? "engineer", ...(now.tool ? { tool: now.tool } : {}), ...(now.target && !opts.share ? { target: now.target } : {}) } : null;
  const task = spawn?.agentTask && (!opts.share || opts.titles) ? spawn.agentTask : undefined;
  return {
    kind: spawn ? "sub" : "main",
    ...(spawn?.agentType ? { agentType: spawn.agentType } : {}),
    ...(task ? { task } : {}),
    doing,
    sinceMs: Math.max(0, t - (now ? now.ts : last)),
    tokens,
    children,
    ...(spawn?.parentAgentId ? { parent: spawn.parentAgentId } : {}),
  };
}
