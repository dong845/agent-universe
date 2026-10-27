import { describe, expect, it } from "vitest";
import { demoScenario, DEMO } from "../packages/mock/src/scenario.ts";
import { buildLedger, formatCount, keys, totalOf } from "../packages/schema/src/aggregate.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";

const ev = demoScenario();
const sec = (s: number) => DEMO.t0 + s * 1000;

describe("demo scenario is well-formed", () => {
  it("has unique ids and is sorted", () => {
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
    for (let i = 1; i < ev.length; i++) expect(ev[i].ts).toBeGreaterThanOrEqual(ev[i - 1].ts);
  });

  it("pairs every tool_start with exactly one later tool_end", () => {
    const starts = ev.filter((e) => e.kind === "tool_start");
    const ends = ev.filter((e) => e.kind === "tool_end");
    expect(starts.length).toBe(ends.length);
    for (const s of starts) {
      const m = ends.filter((x) => x.toolUseId === s.toolUseId);
      expect(m).toHaveLength(1);
      expect(m[0].ts).toBeGreaterThan(s.ts);
      expect(m[0].agentId).toBe(s.agentId);
    }
  });

  it("keeps every subagent event between its spawn and its return", () => {
    for (const sp of ev.filter((e) => e.kind === "agent_spawn")) {
      const ret = ev.find((e) => e.kind === "agent_return" && e.agentId === sp.agentId)!;
      for (const e of ev.filter((x) => x.agentId === sp.agentId)) {
        expect(e.ts).toBeGreaterThanOrEqual(sp.ts);
        expect(e.ts).toBeLessThanOrEqual(ret.ts);
      }
    }
  });

  it("has no negative tokens and one task", () => {
    for (const e of ev) if (e.tokens) for (const v of Object.values(e.tokens)) expect(v).toBeGreaterThanOrEqual(0);
    expect(ev.filter((e) => e.kind === "task_start")).toHaveLength(1);
    expect(ev.filter((e) => e.kind === "task_end")).toHaveLength(1);
  });
});

describe("ledger", () => {
  const L = buildLedger(ev);
  const taskId = ev[0].taskId!;
  const end = sec(60);
  const sumOf = (pred: (e: AgentTownEvent) => boolean) =>
    ev.filter((e) => e.kind === "model_call" && pred(e)).reduce((n, e) => n + totalOf(e.tokens!), 0);

  it("task total equals the sum of its model calls", () => {
    expect(totalOf(L.tokensAt(keys.task(taskId), end))).toBe(sumOf(() => true));
  });

  it("subagent subtotal and per-agent totals add up to the task", () => {
    expect(totalOf(L.tokensAt(keys.taskSubagents(taskId), end))).toBe(sumOf((e) => e.agentId !== "main"));
    const agents = ["main", "agent-scout", "agent-tests"].map((a) => totalOf(L.tokensAt(`agent:${DEMO.sessionId}:${a}`, end)));
    expect(agents.reduce((a, b) => a + b, 0)).toBe(totalOf(L.tokensAt(keys.task(taskId), end)));
  });

  it("is zero before the first call and never decreases", () => {
    expect(totalOf(L.tokensAt(keys.global(), sec(0)))).toBe(0);
    let prev = 0;
    for (let s = 0; s <= 56; s += 0.5) {
      const v = totalOf(L.tokensAt(keys.global(), sec(s)));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("counts the first model call at its own timestamp, not before", () => {
    expect(totalOf(L.tokensAt(keys.global(), sec(1.499)))).toBe(0);
    expect(totalOf(L.tokensAt(keys.global(), sec(1.5)))).toBe(2400 + 15000 + 6000 + 380);
  });

  it("attributes the next call's new input to the training ground (worked by hand)", () => {
    // tests end at 16.0 (subagent), 28.0, 34.0, 42.7; the next call of the same agent reads the result:
    // 17.0 → 1100+800, 28.5 → 2600+4400, 34.5 → 3100+6900, 43.0 → 1300+1600
    const b = L.buildingAt(keys.building({ faction: "claude-code", projectId: DEMO.projectId }, "training"), end);
    expect(b.calls).toBe(4);
    expect(b.attributedInput).toBe(1900 + 7000 + 10000 + 2900);
    expect(b.durationMs).toBe(2500 + 3000 + 3000 + 3200);
  });

  it("formats counts as the plan says", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(12_400)).toBe("12.4k");
    expect(formatCount(1_300_000)).toBe("1.3M");
  });
});
