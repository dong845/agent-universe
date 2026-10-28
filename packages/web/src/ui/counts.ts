// "In progress" counts for the HUD and the faction card. A task that stopped without a recorded end
// and is not live (`unended`) is never in progress.
import type { AgentTownEvent } from "../../../schema/src/event.ts";

function open(events: AgentTownEvent[], abs: number, pred: (e: AgentTownEvent) => boolean, unended: Set<string>): Map<string, string> {
  const m = new Map<string, string>(); // task → session
  for (const e of events) {
    if (e.ts > abs) break;
    if (!e.taskId || unended.has(e.taskId) || !pred(e)) continue;
    if (e.kind === "task_start") m.set(e.taskId, e.sessionId);
    if (e.kind === "task_end") m.delete(e.taskId);
  }
  return m;
}

export function openTasks(events: AgentTownEvent[], abs: number, unended: Set<string>): number {
  return open(events, abs, () => true, unended).size;
}

/** sessions with a task started and not yet ended at `abs` */
export function openSessions(events: AgentTownEvent[], abs: number, pred: (e: AgentTownEvent) => boolean, unended: Set<string>): number {
  return new Set(open(events, abs, pred, unended).values()).size;
}
