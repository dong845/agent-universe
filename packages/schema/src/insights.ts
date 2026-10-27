// Rework detection (plan "返工" + insight "返工循环"), as one pure function both the world and the
// insight layer use.
//
// Exact rule (docs/decisions.md D12):
//  - a test result is the tool_end of a tool_start whose role is "inspector";
//  - from a failing test until the next passing test (or task end) the site smokes;
//  - inside that failing stretch, every successful edit (role "smith") counts against its target
//    file; when one file reaches REWORK_EDITS edits the rework cloud appears, and it clears at the
//    next passing test or task end.
import type { AgentTownEvent } from "./event.ts";

export const REWORK_EDITS = 3;

export interface Interval {
  taskId: string;
  start: number;
  end: number | null; // null: still open at the end of the events
  /** the event that opened it */
  eventId: string;
  file?: string;
}

export interface Rework {
  smoke: Interval[];
  clouds: Interval[];
}

export function detectRework(input: AgentTownEvent[]): Rework {
  const events = [...input].sort((a, b) => a.ts - b.ts);
  const starts = new Map<string, AgentTownEvent>();
  const smoke: Interval[] = [];
  const clouds: Interval[] = [];
  const state = new Map<string, { smoke?: Interval; cloud?: Interval; edits: Map<string, number> }>();
  const of = (taskId: string) => {
    let s = state.get(taskId);
    if (!s) state.set(taskId, (s = { edits: new Map() }));
    return s;
  };
  const close = (taskId: string, t: number) => {
    const s = of(taskId);
    if (s.smoke) s.smoke.end = t;
    if (s.cloud) s.cloud.end = t;
    s.smoke = s.cloud = undefined;
    s.edits.clear();
  };

  for (const e of events) {
    if (e.kind === "tool_start" && e.toolUseId) starts.set(e.toolUseId, e);
    if (!e.taskId) continue;
    if (e.kind === "task_end") {
      close(e.taskId, e.ts);
      continue;
    }
    if (e.kind !== "tool_end" || !e.toolUseId) continue;
    const s = starts.get(e.toolUseId);
    if (!s) continue;
    if (s.role === "inspector" && e.status !== "denied") {
      if (e.status === "ok") {
        close(e.taskId, e.ts);
      } else {
        const st = of(e.taskId);
        if (!st.smoke) {
          st.smoke = { taskId: e.taskId, start: e.ts, end: null, eventId: e.id };
          smoke.push(st.smoke);
        }
      }
    } else if (s.role === "smith" && e.status === "ok") {
      const st = of(e.taskId);
      if (!st.smoke || !s.target) continue; // only edits inside a failing stretch count
      const n = (st.edits.get(s.target) ?? 0) + 1;
      st.edits.set(s.target, n);
      if (n >= REWORK_EDITS && !st.cloud) {
        st.cloud = { taskId: e.taskId, start: e.ts, end: null, eventId: e.id, file: s.target };
        clouds.push(st.cloud);
      }
    }
  }
  return { smoke, clouds };
}
