// A project's overview (spec 2026-11-05 D26 C): how big it is, from its requests and its city.
import { describe, expect, it } from "vitest";
import type { RequestRow } from "../packages/schema/src/payload.ts";
import { townOverview } from "../packages/web/src/city/overview.ts";

const TZ = "Europe/Amsterdam";
const day = (d: string, h = 12) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00+01:00`);
let n = 0;
const req = (end: number, extra: Partial<RequestRow> = {}): RequestRow => ({
  requestId: `r${n++}`, faction: "claude-code", projectId: "/p/alpha", sessionId: "s", startTs: end - 60_000, endTs: end, ok: true,
  class: "produced", productKind: "code", tokens: { input: 10, output: 20, cacheRead: 100, cacheWrite: 5 }, calls: 3, fails: 0, spawns: 1,
  skills: [], topDir: null, turns: 1, taskIds: [`t${n}`], work: { smith: 2, scout: 1 }, ...extra,
});
const reqs = [
  req(day("2026-11-01"), { skills: ["slide-maker"] }), req(day("2026-11-02"), { productKind: "docs" }), req(day("2026-11-03"), { class: "investigation", productKind: null }),
  req(day("2026-11-05"), { class: "chat", productKind: null, spawns: 0 }), req(day("2026-11-05"), { class: "empty", productKind: null, spawns: 0, skills: ["slide-maker", "pdf"] }),
  req(day("2026-11-05"), { projectId: "/p/other" }),
];
const spot = (info: object, extra = {}) => ({ art: {} as never, x: 0, z: 0, size: 1, cell: "0,0", info, ...extra }) as never;
const w = {
  towns: new Map([["claude-code|/p/alpha", { key: "claude-code|/p/alpha", name: "alpha", kind: "project", workCounts: { smith: 10, scout: 6, engineer: 2 } }]]),
  requests: new Map(reqs.map((r) => [r.requestId, r])),
  layouts: new Map([["claude-code|/p/alpha", { cells: [], radius: 10, streets: [{ name: "src", x: 0, z: 0, drawn: 2, minor: 0 }], spots: [
    spot({ kind: "house", requestId: reqs[0].requestId }), spot({ kind: "house", requestId: reqs[1].requestId }), spot({ kind: "tent", requestId: reqs[2].requestId }),
    spot({ kind: "public", work: "smith", count: 10 }), spot({ kind: "public", work: "scout", count: 6 }), spot({ kind: "hall" }),
  ] }]]),
  live: new Set([reqs[3].requestId]),
} as never;

describe("townOverview", () => {
  const o = townOverview(w, "claude-code|/p/alpha", day("2026-11-05", 18), TZ)!;
  it("counts requests by kind, its own town only", () => {
    expect(o.requests).toEqual({ total: 5, produced: 2, investigation: 1, chat: 2 });
    expect(o.products).toEqual([{ kind: "code", n: 1 }, { kind: "docs", n: 1 }]);
  });
  it("tokens, active days, first and last, the longest streak", () => {
    expect(o.tokens).toBe(5 * 135);
    expect(o.activeDays).toBe(4);
    expect(o.first).toBe(day("2026-11-01"));
    expect(o.last).toBe(day("2026-11-05"));
    expect(o.streak).toBe(3);
  });
  it("what the city has built", () => {
    expect(o.built).toEqual({ houses: 2, tents: 1, streets: 1, public: [{ work: "smith", n: 10 }, { work: "scout", n: 6 }] });
  });
  it("the work done most, subagents, skills, and what runs now", () => {
    expect(o.work.map((x) => x.role)).toEqual(["smith", "scout", "engineer"]);
    expect(o.spawns).toBe(3);
    expect(o.skills).toEqual([{ name: "slide-maker", n: 2 }, { name: "pdf", n: 1 }]);
    expect(o.liveNow).toBe(1);
  });
  it("an unknown town: nothing", () => expect(townOverview(w, "codex|/nope", 0, TZ)).toBeNull());
});
