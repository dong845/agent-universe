// What a followed agent is doing (spec 2026-11-05 C1), from the town's events.
import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { agentFacts, agentIdOf } from "../packages/web/src/city/agentFacts.ts";

const base = { faction: "claude-code" as const, projectId: "/p", sessionId: "s", taskId: "t1", raw: { file: "", line: 0 } };
let n = 0;
const ev = (agentId: string, ts: number, kind: AgentTownEvent["kind"], extra: Partial<AgentTownEvent> = {}): AgentTownEvent => ({ ...base, id: `e${n++}`, ts, agentId, kind, ...extra });
const tok = (o: number) => ({ input: 10, output: o, cacheRead: 100, cacheWrite: 5 });
const events: AgentTownEvent[] = [
  ev("main", 0, "task_start", { title: "build it" }),
  ev("main", 1, "model_call", { tokens: tok(5) }),
  ev("main", 2, "tool_start", { tool: "Agent", toolUseId: "u-agent", role: "commander" }),
  ev("sub", 3, "agent_spawn", { parentAgentId: "main", agentType: "Explore", agentTask: "find the SECRET thing" }),
  ev("sub", 4, "tool_start", { tool: "Read", toolUseId: "u-read", role: "scout", target: "/home/me/SECRET/a.ts" }),
  ev("sub", 5, "model_call", { tokens: tok(9) }),
  ev("sub", 6, "tool_end", { toolUseId: "u-read" }),
  ev("main", 7, "model_call", { tokens: tok(1) }),
  ev("main", 8, "tool_start", { tool: "Bash", toolUseId: "u-bash", role: "engineer", target: "npm test" }),
  ev("late", 20, "agent_spawn", { parentAgentId: "main", agentType: "general-purpose" }),
];
const open = { share: false, titles: true };

describe("agentFacts", () => {
  it("the open tool call is what it is doing now, and since when", () => {
    const f = agentFacts(events, "sub", 5, open);
    expect(f).toMatchObject({ kind: "sub", agentType: "Explore", task: "find the SECRET thing", parent: "main" });
    expect(f.doing).toEqual({ role: "scout", tool: "Read", target: "/home/me/SECRET/a.ts" });
    expect(f.sinceMs).toBe(1);
  });
  it("a finished call is not 'doing'", () => {
    expect(agentFacts(events, "sub", 6, open).doing).toBeNull();
    expect(agentFacts(events, "main", 9, open).doing).toEqual({ role: "engineer", tool: "Bash", target: "npm test" });
  });
  it("tokens up to now only, all four kinds", () => {
    expect(agentFacts(events, "main", 3, open).tokens).toBe(120);
    expect(agentFacts(events, "main", 9, open).tokens).toBe(120 + 116);
  });
  it("the subagents it sent by now", () => {
    expect(agentFacts(events, "main", 9, open).children).toEqual(["sub"]);
    expect(agentFacts(events, "main", 30, open).children).toEqual(["sub", "late"]);
    expect(agentFacts(events, "main", 9, open).kind).toBe("main");
  });
  it("share mode hides the target, and the task unless titles are shown", () => {
    const f = agentFacts(events, "sub", 5, { share: true, titles: false });
    expect(f.doing).toEqual({ role: "scout", tool: "Read" });
    expect(f.task).toBeUndefined();
    expect(agentFacts(events, "sub", 5, { share: true, titles: true }).task).toBe("find the SECRET thing");
  });
  it("an agent it has never seen: nothing, no throw", () => {
    expect(agentFacts(events, "ghost", 9, open)).toEqual({ seen: false, kind: "sub", doing: null, sinceMs: 0, tokens: 0, children: [] });
  });
});

describe("agentIdOf", () => {
  it("reads the agent id out of a robot id", () => {
    expect(agentIdOf("live|abc")).toBe("abc");
    expect(agentIdOf("rp|abc")).toBe("abc");
    expect(agentIdOf("hist|abc|3")).toBe("abc");
    expect(agentIdOf("hist|a|b|3")).toBe("a|b");
  });
});

describe("Esc while following (spec 2026-11-05 C1)", () => {
  it("one step back: first lets go of the agent, then leaves the city", async () => {
    const { useStore } = await import("../packages/web/src/store.ts");
    useStore.setState({ city: "claude-code|/p", focus: "claude-code|/p", selected: null, followAgent: "live|main" });
    useStore.getState().back();
    expect(useStore.getState().followAgent).toBeNull();
    expect(useStore.getState().city).toBe("claude-code|/p");
    useStore.getState().back();
    expect(useStore.getState().city).toBeNull();
  });
});
