import { describe, expect, it } from "vitest";
import { demoScenario, DEMO } from "../packages/mock/src/scenario.ts";
import type { AgentTownEvent, Role } from "../packages/schema/src/event.ts";
import { detectRework } from "../packages/schema/src/insights.ts";

const sec = (s: number) => DEMO.t0 + s * 1000;

/** a tiny builder for hand-made sequences */
function seq(steps: [number, Role, "ok" | "error" | "denied", string?][], taskEnd?: number): AgentTownEvent[] {
  const base = { faction: "claude-code" as const, projectId: "p", sessionId: "s", taskId: "T", agentId: "main", raw: { file: "x", line: 0 } };
  const out: AgentTownEvent[] = [];
  steps.forEach(([t, role, status, target], i) => {
    out.push({ ...base, id: `s${i}`, ts: t, kind: "tool_start", toolUseId: `u${i}`, role, target });
    out.push({ ...base, id: `e${i}`, ts: t + 1, kind: "tool_end", toolUseId: `u${i}`, status });
  });
  if (taskEnd !== undefined) out.push({ ...base, id: "end", ts: taskEnd, kind: "task_end" });
  return out;
}

describe("rework on the demo", () => {
  const r = detectRework(demoScenario());

  it("smokes from the first failing test to the passing one", () => {
    expect(r.smoke).toHaveLength(1);
    expect(r.smoke[0].start).toBe(sec(16.0)); // the subagent's test written before the fix
    expect(r.smoke[0].end).toBe(sec(42.7));
  });

  it("raises the cloud at the third edit of client.ts inside the failing stretch", () => {
    expect(r.clouds).toHaveLength(1);
    expect(r.clouds[0].file).toBe("src/http/client.ts");
    expect(r.clouds[0].start).toBe(sec(37.8));
    expect(r.clouds[0].end).toBe(sec(42.7));
  });
});

describe("rework rule edges", () => {
  it("ignores edits made before any failure", () => {
    const r = detectRework(seq([[0, "smith", "ok", "a"], [10, "smith", "ok", "a"], [20, "smith", "ok", "a"], [30, "inspector", "error"]]));
    expect(r.smoke).toHaveLength(1);
    expect(r.clouds).toHaveLength(0);
  });

  it("needs three edits of the same file, not three edits in total", () => {
    const r = detectRework(seq([[0, "inspector", "error"], [10, "smith", "ok", "a"], [20, "smith", "ok", "b"], [30, "smith", "ok", "a"]]));
    expect(r.clouds).toHaveLength(0);
  });

  it("does not count failed or denied edits, nor denied tests", () => {
    const r = detectRework(seq([[0, "inspector", "denied"], [5, "inspector", "error"], [10, "smith", "error", "a"], [20, "smith", "denied", "a"], [30, "smith", "ok", "a"]]));
    expect(r.smoke).toHaveLength(1);
    expect(r.smoke[0].start).toBe(6);
    expect(r.clouds).toHaveLength(0);
  });

  it("closes smoke and cloud at task end and leaves them open without one", () => {
    const steps: [number, Role, "ok" | "error", string?][] = [[0, "inspector", "error"], [10, "smith", "ok", "a"], [20, "smith", "ok", "a"], [30, "smith", "ok", "a"]];
    const closed = detectRework(seq(steps, 100));
    expect(closed.clouds[0].end).toBe(100);
    expect(closed.smoke[0].end).toBe(100);
    const open = detectRework(seq(steps));
    expect(open.clouds[0].end).toBeNull();
    expect(open.smoke[0].end).toBeNull();
  });

  it("starts counting again after a passing test", () => {
    const r = detectRework(seq([[0, "inspector", "error"], [10, "smith", "ok", "a"], [20, "smith", "ok", "a"], [30, "inspector", "ok"], [40, "inspector", "error"], [50, "smith", "ok", "a"]]));
    expect(r.smoke).toHaveLength(2);
    expect(r.clouds).toHaveLength(0);
  });
});
