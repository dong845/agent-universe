import { describe, expect, it } from "vitest";
import type { RequestRow } from "../packages/schema/src/payload.ts";
import type { TownRow } from "../packages/schema/src/towns.ts";
import { layoutTown, LAYOUT_DEFAULTS } from "../packages/web/src/v3/townLayout.ts";

let n = 0;
const req = (p: Partial<RequestRow> = {}): RequestRow => {
  const i = n++;
  return { requestId: `r${i}`, faction: "claude-code", projectId: "/p/app", sessionId: "s", startTs: i * 1000, endTs: i * 1000 + 500, ok: true, class: "produced", productKind: "code", tokens: { input: 10, output: 10, cacheRead: 0, cacheWrite: 10 * (i + 1) }, calls: 5, fails: 0, spawns: 0, skills: [], topDir: "src", turns: 1, taskIds: [`t${i}`], ...p };
};
const town = (p: Partial<TownRow> = {}): TownRow => ({ key: "claude-code|/p/app", faction: "claude-code", projectId: "/p/app", name: "app", kind: "project", guildOf: [], theme: "publishing", counts: { produced: 0, investigation: 0, chat: 0, empty: 0 }, workCounts: { scout: 400, smith: 120, engineer: 900, scribe: 4 }, lastEditTs: null, ...p });
const kinds = (l: ReturnType<typeof layoutTown>, k: string) => l.spots.filter((s) => s.info.kind === k);
const cellOf = (x: number, z: number) => { const r = Math.round(z / Math.sqrt(3)); const q = Math.round(x / 2 - r / 2); return `${q},${r}`; };

describe("layoutTown", () => {
  const big = () => {
    const rs = [...Array.from({ length: 50 }, (_, i) => req({ topDir: ["skills", "docs", null, ".claude", "."][i % 5] })), ...Array.from({ length: 21 }, (_, i) => req({ class: "investigation", productKind: null, calls: 20 + i }))];
    return { rs, l: layoutTown(town(), rs, LAYOUT_DEFAULTS) };
  };

  it("draws the main work only: the larger half, at most 20 houses, 6 tents", () => {
    const { l } = big();
    expect(kinds(l, "house")).toHaveLength(20);
    expect(kinds(l, "tent")).toHaveLength(6);
  });

  it("the drawn houses are the biggest by tokens; minor ones are counted on their street", () => {
    const { rs, l } = big();
    const top = rs.filter((r) => r.class === "produced").sort((a, b) => b.tokens.cacheWrite - a.tokens.cacheWrite).slice(0, 20).map((r) => r.requestId).sort();
    expect(kinds(l, "house").map((s) => (s.info as { requestId: string }).requestId).sort()).toEqual(top);
    expect(l.streets.reduce((a, s) => a + s.drawn + s.minor, 0)).toBe(50);
  });

  it("no two buildings share a cell (the landmark's growth stages take turns on the centre)", () => {
    const { l } = big();
    const cells = l.spots.filter((s) => s.info.kind !== "prop" && !(s.info.kind === "landmark" && s.until !== undefined)).map((s) => s.cell);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("a house stands in its own street's wedge", () => {
    const { l } = big();
    for (const s of kinds(l, "house")) {
      const st = l.streets.find((x) => x.name === s.street)!;
      const a = Math.atan2(-s.z, s.x), m = Math.atan2(-st.z, st.x);
      const d = Math.abs(Math.atan2(Math.sin(a - m), Math.cos(a - m)));
      expect(d).toBeLessThanOrEqual(Math.PI / l.streets.length + 1e-6);
    }
  });

  it("only kinds of work done at least 5 times get a public building", () => {
    const { l } = big();
    expect(kinds(l, "public").map((s) => (s.info as { work: string }).work).sort()).toEqual(["engineer", "scout", "smith"]);
  });

  it("a town with no finished work: hall and notice board, no landmark, no houses", () => {
    const l = layoutTown(town(), [req({ class: "chat", productKind: null }), req({ class: "chat", productKind: null })], LAYOUT_DEFAULTS);
    expect(kinds(l, "hall")).toHaveLength(1);
    expect(kinds(l, "notice")).toHaveLength(1);
    expect(kinds(l, "landmark")).toHaveLength(0);
    expect(kinds(l, "house")).toHaveLength(0);
  });

  it("the landmark grows with finished work: tier 1 from 1, 2 from 10, 3 from 40, appearing when each was reached", () => {
    const tierOf = (k: number) => {
      const rs = Array.from({ length: k }, () => req());
      const lm = kinds(layoutTown(town(), rs, LAYOUT_DEFAULTS), "landmark");
      return lm.map((s) => [(s.info as { tier: number }).tier, s.from]);
    };
    expect(tierOf(1).map((x) => x[0])).toEqual([1]);
    const ten = tierOf(10);
    expect(ten.map((x) => x[0])).toEqual([1, 2]);
    expect(ten[1][1]).toBeGreaterThan(ten[0][1] as number);
    expect(tierOf(40).map((x) => x[0])).toEqual([1, 2, 3]);
  });

  it("folders: null → 其他, '.' → 根目录, beyond six streets fold into 其他", () => {
    const dirs = ["a", "b", "c", "d", "e", "f", "g", null, "."];
    const l = layoutTown(town(), dirs.map((d) => req({ topDir: d })), LAYOUT_DEFAULTS);
    const names = l.streets.map((s) => s.name);
    expect(names.length).toBeLessThanOrEqual(6);
    expect(names).toContain("其他");
    expect(l.streets.reduce((a, s) => a + s.drawn + s.minor, 0)).toBe(9);
  });

  it("hundreds of finished requests: still 20 houses, every one counted", () => {
    const rs = Array.from({ length: 300 }, (_, i) => req({ topDir: `d${i % 9}` }));
    const l = layoutTown(town(), rs, LAYOUT_DEFAULTS);
    expect(kinds(l, "house")).toHaveLength(20);
    expect(l.streets.reduce((a, s) => a + s.drawn + s.minor, 0)).toBe(300);
  });

  it("the same input gives the same layout", () => {
    const { rs } = big();
    expect(JSON.stringify(layoutTown(town(), rs, LAYOUT_DEFAULTS))).toBe(JSON.stringify(layoutTown(town(), rs, LAYOUT_DEFAULTS)));
  });

  it("houses appear when their request ended", () => {
    const { rs, l } = big();
    for (const s of kinds(l, "house")) expect(s.from).toBe(rs.find((r) => r.requestId === (s.info as { requestId: string }).requestId)!.endTs);
  });
});
