import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import type { RequestRow } from "../packages/schema/src/payload.ts";
import type { TownRow } from "../packages/schema/src/towns.ts";
import { fromHash, requestOfTask, toHash } from "../packages/web/src/selection.ts";
import { requestDiaries } from "../packages/web/src/ui/diaryModel.ts";
import { LAYOUT_DEFAULTS, layoutTown } from "../packages/web/src/v3/townLayout.ts";

describe("selection by URL", () => {
  it("round-trips a request and a town, names with ~ and | included", () => {
    for (const s of [{ kind: "request" as const, district: "codex|/a~b/c", requestId: "r~1" }, { kind: "town" as const, district: "claude-code|/x y" }]) expect(fromHash(toHash(s))).toEqual(s);
  });
  it("an old #task link leads to the request holding that turn", () => {
    const req = { requestId: "R", faction: "codex", projectId: "/p", taskIds: ["T1", "T2"] } as unknown as RequestRow;
    const old = fromHash(toHash({ kind: "task", district: "codex|/p", taskId: "T2" }))!;
    expect(requestOfTask(old, [req])).toEqual({ kind: "request", district: "codex|/p", requestId: "R" });
    expect(requestOfTask(old, [])).toBeNull();
  });
});

describe("a request's diary", () => {
  let n = 0;
  const ev = (taskId: string, ts: number, p: Partial<AgentTownEvent>): AgentTownEvent => ({ id: `e${n++}`, ts, faction: "codex", projectId: "/p", sessionId: "s", taskId, agentId: "main", kind: "tool_start", raw: { file: "f", line: 1 }, ...p });
  it("one section per turn, in the order they started; a turn with no events is left out", () => {
    const evs = [ev("T2", 200, { kind: "task_start", trigger: "system" }), ev("T2", 210, { tool: "Edit", toolUseId: "b" }), ev("T1", 100, { kind: "task_start", trigger: "human", title: "做事" }), ev("T1", 110, { tool: "Read", toolUseId: "a" })];
    const ds = requestDiaries(evs, ["T2", "T1", "T9"], new Set());
    expect(ds.map((d) => d.taskId)).toEqual(["T1", "T2"]);
    expect(ds[0].main.length + ds[1].main.length).toBe(2);
  });
});

describe("a request in progress", () => {
  const town = { key: "codex|/p", faction: "codex", projectId: "/p", name: "p", kind: "project", guildOf: [], theme: "craftsmen", counts: { produced: 0, investigation: 0, chat: 1, empty: 0 }, workCounts: {}, lastEditTs: null } as TownRow;
  const r = { requestId: "L", faction: "codex", projectId: "/p", sessionId: "s", startTs: 1, endTs: 2, ok: null, class: "chat", productKind: null, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, calls: 1, fails: 0, spawns: 0, skills: [], topDir: null, turns: 1, taskIds: ["T"] } as RequestRow;
  it("always stands as a house while it runs, even before it has made anything", () => {
    const l = layoutTown(town, [r], { ...LAYOUT_DEFAULTS, live: new Set(["L"]) });
    const h = l.spots.filter((s) => s.info.kind === "house");
    expect(h).toHaveLength(1);
    expect(h[0].live).toBe(true);
    expect(h[0].from).toBe(1);
  });
});

describe("review fixes", () => {
  const town = { key: "codex|/p", faction: "codex", projectId: "/p", name: "p", kind: "project", guildOf: [], theme: "craftsmen", counts: { produced: 0, investigation: 0, chat: 0, empty: 0 }, workCounts: {}, lastEditTs: null } as TownRow;
  const req = (i: number, live = false): RequestRow => ({ requestId: `${live ? "L" : "R"}${i}`, faction: "codex", projectId: "/p", sessionId: "s", startTs: i, endTs: i + 1, ok: live ? null : true, class: "produced", productKind: "code", tokens: { input: i, output: 1, cacheRead: 0, cacheWrite: 0 }, calls: 1, fails: 0, spawns: 0, skills: [], topDir: "src", turns: 1, taskIds: [`T${live ? "L" : "R"}${i}`] });

  it("requests in progress count inside the 20-house cap, and never crash the layout", () => {
    const rs = [...Array.from({ length: 60 }, (_, i) => req(i)), ...Array.from({ length: 40 }, (_, i) => req(i, true))];
    const live = new Set(rs.filter((r) => r.requestId.startsWith("L")).map((r) => r.requestId));
    const l = layoutTown(town, rs, { ...LAYOUT_DEFAULTS, live });
    const houses = l.spots.filter((s) => s.info.kind === "house");
    expect(houses.length).toBeLessThanOrEqual(20);
    expect(houses.filter((h) => h.live).length).toBe(20); // the work in progress comes first
  });

  it("an old #task link to a turn the world does not know opens nothing", () => {
    expect(requestOfTask({ kind: "task", district: "codex|/p", taskId: "nope" }, [])).toBeNull();
  });
});
