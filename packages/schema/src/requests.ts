// A request is what the user asked for: one human-opened turn plus every system-opened turn that
// continues it (subagent hand-backs, compaction summaries, other meta lines) — spec v3 4.1.
// Pure: the browser builds the demo with it too.
import type { AgentTownEvent } from "./event.ts";

/**
 * taskId → requestId. A human turn (or one with no trigger) is its own request; a system turn joins
 * the latest human turn of the same faction and session that started at or before it, else it is
 * its own request.
 */
export function requestIdsOf(events: AgentTownEvent[]): Map<string, string> {
  const starts = events.filter((e) => e.kind === "task_start" && e.taskId).sort((a, b) => a.ts - b.ts);
  const lastHuman = new Map<string, string>();
  const out = new Map<string, string>();
  for (const e of starts) {
    const taskId = e.taskId!;
    if (out.has(taskId)) continue;
    const session = `${e.faction}|${e.sessionId}`;
    if (e.trigger === "system") {
      out.set(taskId, lastHuman.get(session) ?? taskId);
    } else {
      lastHuman.set(session, taskId);
      out.set(taskId, taskId);
    }
  }
  return out;
}
