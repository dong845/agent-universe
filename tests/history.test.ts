// The history panel (owner 2026-11-01): a town's requests as steps, oldest first, each explained only
// from what the logs record.
import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import type { RequestRow } from "../packages/schema/src/payload.ts";
import { historySteps, stepFacts } from "../packages/web/src/city/history.ts";
import { useStore } from "../packages/web/src/store.ts";

describe("historySteps", () => {
  const p = demoPayload();
  useStore.getState().load(p);
  const w = useStore.getState().w25!;
  const town = p.towns[0].key;
  const steps = historySteps(w, town);
  it("every non-empty request of the town, oldest first, numbered from 1", () => {
    const mine = p.requests.filter((r) => `${r.faction}|${r.projectId}` === town && r.class !== "empty");
    expect(steps.map((s) => s.request.requestId).sort()).toEqual(mine.map((r) => r.requestId).sort());
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i + 1));
    for (let i = 1; i < steps.length; i++) expect(steps[i].request.endTs).toBeGreaterThanOrEqual(steps[i - 1].request.endTs);
  });
  it("says which steps the city draws a building for", () => {
    const drawn = new Set(w.layouts.get(town)!.spots.flatMap((s) => (s.info.kind === "house" || s.info.kind === "tent" ? [s.info.requestId] : [])));
    expect(steps.every((s) => s.drawn === drawn.has(s.request.requestId))).toBe(true);
    expect(steps.some((s) => s.drawn)).toBe(true);
  });
  it("an unknown town has no steps", () => expect(historySteps(w, "claude-code|/nowhere")).toEqual([]));
});

describe("stepFacts", () => {
  const r: RequestRow = {
    requestId: "r1", faction: "claude-code", projectId: "/synthetic/shop", sessionId: "s", startTs: Date.UTC(2026, 9, 25, 10, 0), endTs: Date.UTC(2026, 9, 25, 10, 29),
    ok: true, title: "检查更新，然后 push", class: "produced", productKind: "code", tokens: { input: 50, output: 22_900, cacheRead: 12_600_000, cacheWrite: 31_800 },
    calls: 5, fails: 1, spawns: 1, skills: ["job-hunt"], topDir: "src", turns: 2, taskIds: ["t1"],
  };
  const base = { faction: "claude-code" as const, projectId: "/synthetic/shop", sessionId: "s", taskId: "t1", raw: { file: "", line: 0 } };
  let n = 0;
  const call = (role: AgentTownEvent["role"], tool: string, agentId = "main", files?: AgentTownEvent["files"], status: AgentTownEvent["status"] = "ok"): AgentTownEvent[] => {
    const id = `c${n++}`;
    return [{ ...base, id, ts: n, agentId, kind: "tool_start", role, tool, toolUseId: id, files }, { ...base, id: `${id}e`, ts: n, agentId, kind: "tool_end", toolUseId: id, status }];
  };
  const events = [
    ...call("scout", "Read", "main", [{ path: "/synthetic/shop/src/a.ts", access: "read" }]),
    ...call("smith", "Edit", "main", [{ path: "/synthetic/shop/src/a.ts", access: "edit" }]),
    ...call("smith", "Edit", "sub-1", [{ path: "/synthetic/shop/src/a.ts", access: "edit" }]),
    ...call("smith", "Write", "sub-1", [{ path: "/synthetic/shop/docs/b.md", access: "edit" }]),
    ...call("engineer", "Bash", "main", undefined, "error"),
  ];
  it("states only what the row and the events record", () => {
    const f = stepFacts(r, events);
    expect(f.title).toBe("检查更新，然后 push");
    expect(f.rows).toContainEqual(["结果", "完成作品 · 代码"]);
    expect(f.rows).toContainEqual(["轮次 · 代理", "2 轮 · 2 个代理（派出 1 个子代理）"]);
    expect(f.rows).toContainEqual(["工具调用", "5 次，失败 1 次"]);
    expect(f.rows).toContainEqual(["技能", "job-hunt"]);
    expect(f.rows.find(([k]) => k === "用时")?.[1]).toBe("29 分钟");
    expect(f.work).toEqual([{ name: "改代码", n: 3 }, { name: "读代码", n: 1 }, { name: "跑命令", n: 1 }]);
    // edited files, relative to the project, most edited first
    expect(f.files).toEqual([{ path: "src/a.ts", edits: 2 }, { path: "docs/b.md", edits: 1 }]);
  });
  it("without events (not loaded yet, or a shared world) it gives the row's facts and no guesses", () => {
    const f = stepFacts({ ...r, title: undefined, skills: [] }, null);
    expect(f.title).toBe("（无标题）");
    expect(f.work).toEqual([]);
    expect(f.files).toEqual([]);
    expect(f.rows.find(([k]) => k === "技能")).toBeUndefined();
  });
});
