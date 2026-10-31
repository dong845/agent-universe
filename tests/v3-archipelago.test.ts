import { describe, expect, it } from "vitest";
import { placeIslands, STRAIT, type IslandIn } from "../packages/web/src/v3/archipelago.ts";

const isl = (key: string, faction: IslandIn["faction"], kind: IslandIn["kind"], radius: number, weight = 1): IslandIn => ({ key, faction, kind, radius, weight });
const sample = (): IslandIn[] => [
  isl("c|cap", "claude-code", "capital", 18, 155), isl("c|out", "claude-code", "outpost", 12, 54), isl("c|g1", "claude-code", "guild", 20, 112), isl("c|p1", "claude-code", "project", 22, 100),
  isl("c|p2", "claude-code", "project", 9, 3), isl("c|p3", "claude-code", "project", 14, 27), isl("c|g2", "claude-code", "guild", 11, 5),
  isl("x|cap", "codex", "capital", 15, 40), isl("x|p1", "codex", "project", 16, 36), isl("x|g1", "codex", "guild", 13, 40), isl("x|out", "codex", "outpost", 10, 9),
];

describe("placeIslands", () => {
  it("no two islands overlap, with sea between them", () => {
    const xs = sample();
    const at = placeIslands(xs);
    for (const a of xs) for (const b of xs) {
      if (a.key >= b.key) continue;
      const p = at.get(a.key)!, q = at.get(b.key)!;
      expect(Math.hypot(p.x - q.x, p.z - q.z), `${a.key} ${b.key}`).toBeGreaterThanOrEqual(a.radius + b.radius + 6 - 1e-6);
    }
  });

  it("Claude in the west, Codex in the east, across the strait", () => {
    const xs = sample();
    const at = placeIslands(xs);
    for (const x of xs) {
      const p = at.get(x.key)!;
      if (x.faction === "claude-code") expect(p.x + x.radius).toBeLessThanOrEqual(-STRAIT / 2 + 1e-6);
      else expect(p.x - x.radius).toBeGreaterThanOrEqual(STRAIT / 2 - 1e-6);
    }
  });

  it("each capital is its side's island nearest the strait; the outpost the farthest out", () => {
    const xs = sample();
    const at = placeIslands(xs);
    for (const f of ["claude-code", "codex"] as const) {
      const side = xs.filter((x) => x.faction === f);
      const near = (x: IslandIn) => Math.abs(at.get(x.key)!.x) - x.radius;
      const cap = side.find((x) => x.kind === "capital")!;
      expect(Math.min(...side.map(near))).toBeCloseTo(near(cap));
      const dist = (x: IslandIn) => Math.hypot(at.get(x.key)!.x - at.get(cap.key)!.x, at.get(x.key)!.z - at.get(cap.key)!.z);
      const out = side.find((x) => x.kind === "outpost")!;
      expect(Math.max(...side.map(dist))).toBeCloseTo(dist(out));
    }
  });

  it("is deterministic and copes with none, one and a side with no capital", () => {
    expect(JSON.stringify([...placeIslands(sample())])).toBe(JSON.stringify([...placeIslands(sample())]));
    expect(placeIslands([]).size).toBe(0);
    expect(placeIslands([isl("x|p", "codex", "project", 10)]).get("x|p")!.x).toBeGreaterThanOrEqual(STRAIT / 2 + 10 - 1e-6);
  });
});
