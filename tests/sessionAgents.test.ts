// One robot per agent (spec 2026-11-05 D26 A1): Claude logs every main agent as "main".
import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { buildTimeline } from "../packages/web/src/orchestrator/timeline.ts";
import { uniqueAgents } from "../packages/web/src/orchestrator/sessionAgents.ts";

let n = 0;
const ev = (faction: AgentTownEvent["faction"], sessionId: string, agentId: string, ts: number, kind: AgentTownEvent["kind"], extra: Partial<AgentTownEvent> = {}): AgentTownEvent =>
  ({ id: `e${n++}`, ts, faction, projectId: "/p", sessionId, taskId: `t-${sessionId}`, agentId, kind, raw: { file: "", line: 0 }, ...extra });

const events = [
  ev("claude-code", "s1", "main", 1, "task_start", { trigger: "human", title: "one" }),
  ev("claude-code", "s2", "main", 2, "task_start", { trigger: "human", title: "two" }),
  ev("claude-code", "s1", "main", 3, "tool_start", { tool: "Read", toolUseId: "a", role: "scout" }),
  ev("claude-code", "s2", "main", 4, "tool_start", { tool: "Edit", toolUseId: "b", role: "smith" }),
  ev("claude-code", "s1", "sub1", 5, "agent_spawn", { parentAgentId: "main", agentType: "Explore" }),
  ev("codex", "th", "th", 6, "task_start", { trigger: "human" }),
];

describe("uniqueAgents", () => {
  it("two Claude sessions in one town are two main agents", () => {
    const u = uniqueAgents(events);
    const tl = buildTimeline(u);
    expect(tl.actors.filter((a) => a.kind === "commander").map((a) => a.id).sort()).toEqual(["main@s1", "main@s2", "th"].sort());
  });
  it("a subagent's parent follows its session's main agent", () => {
    expect(uniqueAgents(events).find((e) => e.agentId === "sub1")!.parentAgentId).toBe("main@s1");
  });
  it("leaves other ids alone, and doing it twice changes nothing", () => {
    const once = uniqueAgents(events);
    expect(uniqueAgents(once)).toEqual(once);
    expect(once.find((e) => e.faction === "codex")!.agentId).toBe("th");
  });
});
