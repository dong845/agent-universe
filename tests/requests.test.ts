import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { requestIdsOf } from "../packages/schema/src/requests.ts";

let n = 0;
function start(taskId: string, ts: number, trigger: "human" | "system", sessionId = "s1", faction: AgentTownEvent["faction"] = "claude-code"): AgentTownEvent {
  return { id: `e${n++}`, ts, faction, projectId: "/p", sessionId, taskId, agentId: "main", kind: "task_start", trigger, raw: { file: "f", line: 1 } };
}

describe("requestIdsOf", () => {
  it("folds a system turn into the human turn before it", () => {
    const m = requestIdsOf([start("h1", 1, "human"), start("x1", 2, "system")]);
    expect(m.get("x1")).toBe("h1");
    expect(m.get("h1")).toBe("h1");
  });

  it("joins the latest human turn, not the first", () => {
    const m = requestIdsOf([start("h1", 1, "human"), start("h2", 5, "human"), start("x1", 6, "system")]);
    expect(m.get("x1")).toBe("h2");
  });

  it("a system turn first in its session is its own request", () => {
    const m = requestIdsOf([start("x0", 1, "system"), start("h1", 2, "human")]);
    expect(m.get("x0")).toBe("x0");
  });

  it("never joins across sessions or factions", () => {
    const m = requestIdsOf([start("h1", 1, "human", "s1", "claude-code"), start("x1", 2, "system", "s1", "codex"), start("x2", 3, "system", "s2")]);
    expect(m.get("x1")).toBe("x1");
    expect(m.get("x2")).toBe("x2");
  });

  it("ignores array order", () => {
    const evs = [start("h1", 1, "human"), start("x1", 2, "system"), start("h2", 3, "human"), start("x2", 4, "system")];
    expect(requestIdsOf([...evs].reverse())).toEqual(requestIdsOf(evs));
    expect(requestIdsOf(evs).get("x2")).toBe("h2");
  });

  it("a task without a trigger counts as human", () => {
    const e = start("h1", 1, "human");
    delete e.trigger;
    expect(requestIdsOf([e, start("x1", 2, "system")]).get("x1")).toBe("h1");
  });
});
