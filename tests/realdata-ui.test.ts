import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { buildWorld } from "../packages/web/src/orchestrator/worldgen.ts";
import { clockLabel, declutter, replayClock } from "../packages/web/src/ui/format.ts";

const ev = (faction: AgentTownEvent["faction"], projectId: string, i: number): AgentTownEvent[] => [
  { id: `s${i}`, ts: i, faction, projectId, sessionId: "s", taskId: `t${i}`, agentId: "main", kind: "task_start", raw: { file: "f", line: 1 } },
  { id: `e${i}`, ts: i + 1, faction, projectId, sessionId: "s", taskId: `t${i}`, agentId: "main", kind: "task_end", raw: { file: "f", line: 1 } },
];

describe("town names", () => {
  const w = buildWorld([...ev("claude-code", "/h/.claude/skills", 1), ...ev("claude-code", "/h/.codex/skills", 3), ...ev("claude-code", "/h", 5), ...ev("codex", "/h/code/app", 7), ...ev("claude-code", "临时工地", 9)], undefined, "/h");
  const name = (f: string, p: string) => w.districts.find((d) => d.faction === f && d.projectId === p)!.name;
  it("tells same-named folders apart by their parent", () => {
    expect(name("claude-code", "/h/.claude/skills")).toBe(".claude/skills");
    expect(name("claude-code", "/h/.codex/skills")).toBe(".codex/skills");
  });
  it("calls the home directory 主目录 and keeps plain names plain", () => {
    expect(name("claude-code", "/h")).toBe("主目录");
    expect(name("codex", "/h/code/app")).toBe("app");
    expect(name("claude-code", "临时工地")).toBe("临时工地");
  });
});

describe("clockLabel", () => {
  it("demo: minutes and seconds of the replay", () => {
    expect(clockLabel(75_000, 0, "demo")).toBe("01:15");
  });
  it("real: the local date and time the clock points at", () => {
    const t0 = new Date(2026, 9, 28, 9, 5).getTime();
    expect(clockLabel(3 * 3_600_000, t0, "real")).toBe("10-28 12:05");
  });
});

describe("declutter", () => {
  it("keeps the higher-priority label where two overlap, and every label that overlaps none", () => {
    const r = (x: number, y: number) => ({ x, y, w: 100, h: 20 });
    const shown = declutter([
      { id: "low", rect: r(0, 0), priority: 1 },
      { id: "high", rect: r(50, 10), priority: 5 },
      { id: "apart", rect: r(400, 400), priority: 0 },
    ]);
    expect([...shown].sort()).toEqual(["apart", "high"]);
  });
  it("breaks priority ties by id, so the picture does not flicker between frames", () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect([...declutter([{ id: "b", rect: r, priority: 1 }, { id: "a", rect: r, priority: 1 }])]).toEqual(["a"]);
  });
});

describe("replayClock", () => {
  it("shows the replayed task's own time, not today's", () => {
    const taskT0 = new Date(2026, 9, 4, 17, 6).getTime();
    // replay started at world clock 1e9; 90 s later the task is at 17:07:30 on 10-04
    expect(replayClock(1e9 + 90_000, { offset: 1e9, t0: taskT0 })).toBe("10-04 17:07");
  });
});
