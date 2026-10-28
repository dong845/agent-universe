import { describe, expect, it } from "vitest";
import { demoScenario } from "../packages/mock/src/scenario.ts";
import { worldScenario } from "../packages/mock/src/world.ts";
import { buildLedger, keys, totalOf } from "../packages/schema/src/aggregate.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { diaryOf } from "../packages/web/src/ui/diaryModel.ts";

const evs = demoScenario();
const ID = "demo:task:0";
const END = Math.max(...evs.map((e) => e.ts)) + 1;
const ledger = buildLedger(evs);
const d = diaryOf(evs, ID, false);

describe("diaryOf: the demo's live task", () => {
  it("has the title, outcome and span of its events", () => {
    expect(d.title).toBe("给 HTTP 客户端加上失败重试，并补上测试");
    expect(d.outcome).toBe("ok");
    expect(d.start).toBe(evs.find((e) => e.kind === "task_start")!.ts);
    expect(d.end).toBe(evs.find((e) => e.kind === "task_end")!.ts);
    expect(d.faction).toBe("claude-code");
  });

  it("lists every tool call of the commander as a step, in time order", () => {
    expect(d.main).toHaveLength(evs.filter((e) => e.agentId === "main" && e.kind === "tool_start").length);
    for (let i = 1; i < d.main.length; i++) expect(d.main[i].ts).toBeGreaterThanOrEqual(d.main[i - 1].ts);
  });

  it("groups each subagent once, with its own steps", () => {
    expect(d.agents.map((a) => a.agentId).sort()).toEqual(["agent-scout", "agent-tests"]);
    const tests = d.agents.find((a) => a.agentId === "agent-tests")!;
    expect(tests.steps).toHaveLength(3);
    expect(tests.agentTask).toBeTruthy();
  });

  it("adds up to the ledger: task total and the subagents' share", () => {
    expect(totalOf(d.tokens)).toBe(totalOf(ledger.tokensAt(keys.task(ID), END)));
    expect(d.subagentTokens).toBe(totalOf(ledger.tokensAt(keys.taskSubagents(ID), END)));
    // each model call is credited to one step at most, so the steps never add up past the task
    const stepTokens = [...d.main, ...d.agents.flatMap((a) => a.steps)].reduce((n, s) => n + (s.tokens ?? 0), 0);
    expect(stepTokens).toBeLessThanOrEqual(totalOf(d.tokens));
  });

  it("marks failed and denied steps", () => {
    const all = [...d.main, ...d.agents.flatMap((a) => a.steps)];
    expect(all.filter((s) => s.status === "denied")).toHaveLength(1);
    expect(all.filter((s) => s.status === "error")).toHaveLength(4);
  });

  it("names the reworked file and how often it was edited", () => {
    expect(d.rework.length).toBeGreaterThan(0);
    for (const r of d.rework) expect(r.edits).toBeGreaterThanOrEqual(3);
  });

  it("is replayable: it has tool calls", () => expect(d.replayable).toBe(true));
});

describe("diaryOf: edge cases", () => {
  const base = { faction: "codex" as const, projectId: "/p", sessionId: "s", agentId: "main", raw: { file: "f", line: 1 } };
  const open: AgentTownEvent[] = [
    { ...base, id: "a", taskId: "T", ts: 1, kind: "task_start" },
    { ...base, id: "b", taskId: "T", ts: 2, kind: "tool_start", tool: "Read", toolUseId: "u", role: "scout" },
  ];

  it("a task that never ended and is not live: outcome unknown, no end, its last step still running", () => {
    const x = diaryOf(open, "T", false);
    expect(x.outcome).toBe("unknown");
    expect(x.end).toBeNull();
    expect(x.main[0].status).toBe("running");
  });

  it("the same task while live: running", () => expect(diaryOf(open, "T", true).outcome).toBe("running"));

  it("a demo history task has no steps to replay", () => {
    const w = worldScenario();
    const hist = w.find((e) => e.kind === "task_start" && e.taskId!.startsWith("h:"))!.taskId!;
    expect(diaryOf(w.filter((e) => e.taskId === hist), hist, false).replayable).toBe(false);
  });

  it("refuses an empty task loudly", () => expect(() => diaryOf([], "X", false)).toThrow("no events for task X"));
});
