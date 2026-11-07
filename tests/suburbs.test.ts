// Suburbs (spec 2026-11-07 D27 C): every finished piece the city does not draw as a house stands as a tiny
// house on the outskirts, so a town's real size shows.
import { describe, expect, it } from "vitest";
import type { RequestRow } from "../packages/schema/src/payload.ts";
import type { TownRow } from "../packages/schema/src/towns.ts";
import { LAYOUT_DEFAULTS, MAX_SUBURBS, cellPos, layoutTown } from "../packages/web/src/v3/townLayout.ts";

const town = { key: "codex|/p", faction: "codex", projectId: "/p", name: "p", kind: "project", guildOf: [], theme: "craftsmen", counts: { produced: 0, investigation: 0, chat: 0, empty: 0 }, workCounts: { engineer: 50, scout: 30 }, lastEditTs: null } as TownRow;
const req = (i: number, o: Partial<RequestRow> = {}): RequestRow => ({ requestId: `R${String(i).padStart(4, "0")}`, faction: "codex", projectId: "/p", sessionId: "s", startTs: 1000 + i, endTs: 2000 + ((i * 7919) % 997), ok: true, class: "produced", productKind: i % 3 ? "code" : "docs", tokens: { input: i, output: 1, cacheRead: 0, cacheWrite: 0 }, calls: 1, fails: 0, spawns: 0, skills: [], topDir: ["src", "docs", null][i % 3], turns: 1, taskIds: [`T${i}`], ...o });
const houses = (l: ReturnType<typeof layoutTown>) => l.spots.filter((s) => s.info.kind === "house");

describe("suburbs", () => {
  it("a town with 138 finished pieces: the ones not drawn as houses are all in the suburbs, by finish time", () => {
    const rs = Array.from({ length: 138 }, (_, i) => req(i));
    const l = layoutTown(town, rs, LAYOUT_DEFAULTS);
    expect(houses(l).length + l.suburbs.length).toBe(138);
    expect(houses(l).length).toBeLessThanOrEqual(20);
    const drawn = new Set(houses(l).map((h) => (h.info as { requestId: string }).requestId));
    expect(l.suburbs.every((s) => !drawn.has(s.requestId))).toBe(true);
    const ends = l.suburbs.map((s) => s.from);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(l.suburbs.find((s) => s.requestId === "R0000")?.kind ?? houses(l).length).toBeTruthy();
  });

  it("tiny houses stand on cells nothing else uses, inside the island", () => {
    const l = layoutTown(town, Array.from({ length: 138 }, (_, i) => req(i)), LAYOUT_DEFAULTS);
    const taken = new Set(l.cells.filter((c) => c.kind !== "grass").map((c) => `${c.q},${c.r}`));
    const props = new Set(l.spots.filter((s) => s.info.kind === "prop" && s.art.category === "prop" && s.art.name.startsWith("tree")).map((s) => s.cell));
    for (const s of l.suburbs) {
      expect(taken.has(s.cell)).toBe(false);
      expect(props.has(s.cell)).toBe(false);
      expect(l.cells.some((c) => `${c.q},${c.r}` === s.cell)).toBe(true);
      const c = cellPos(...(s.cell.split(",").map(Number) as [number, number]));
      expect(Math.hypot(s.x - c.x, s.z - c.z)).toBeLessThan(1);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(l.radius);
    }
  });

  it("none when every finished piece is a house (or none is finished), and work in progress never goes to the suburbs", () => {
    expect(layoutTown(town, [req(1)], LAYOUT_DEFAULTS).suburbs).toEqual([]);
    // a city draws the larger half of its finished work: of two, one is a house and one a tiny house
    expect(layoutTown(town, [req(1), req(2)], LAYOUT_DEFAULTS).suburbs).toHaveLength(1);
    expect(layoutTown(town, [], LAYOUT_DEFAULTS).suburbs).toEqual([]);
    const rs = Array.from({ length: 60 }, (_, i) => req(i, { ok: null }));
    const l = layoutTown(town, rs, { ...LAYOUT_DEFAULTS, live: new Set(rs.map((r) => r.requestId)) });
    expect(l.suburbs).toEqual([]);
  });

  it(`at most ${MAX_SUBURBS}; the rest are counted`, () => {
    const l = layoutTown(town, Array.from({ length: 800 }, (_, i) => req(i)), LAYOUT_DEFAULTS);
    expect(l.suburbs.length).toBe(MAX_SUBURBS);
    expect(l.suburbsMore).toBe(800 - houses(l).length - MAX_SUBURBS);
  });
});
