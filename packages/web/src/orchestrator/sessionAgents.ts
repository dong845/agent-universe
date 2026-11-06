// One robot per agent (spec 2026-11-05 D26 A1): Claude Code logs every session's main agent as "main",
// so two sessions working in one town would merge into one figure jumping between them. Before timelines
// are built, a Claude main agent becomes "main@<session>" (its subagents' parent too). Codex ids are
// thread ids, unique already. Idempotent.
import type { AgentTownEvent } from "../../../schema/src/event.ts";

const MAIN = "main";
export const mainOf = (sessionId: string) => `${MAIN}@${sessionId}`;

export function uniqueAgents(events: readonly AgentTownEvent[]): AgentTownEvent[] {
  return events.map((e) => {
    const own = e.agentId === MAIN;
    const parent = e.parentAgentId === MAIN;
    if (!own && !parent) return e;
    return { ...e, ...(own ? { agentId: mainOf(e.sessionId) } : {}), ...(parent ? { parentAgentId: mainOf(e.sessionId) } : {}) };
  });
}
