import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import manifest from "../art/manifest.json" with { type: "json" };
import type { Manifest } from "../packages/web/src/v3/art.ts";
import { buildWorld25 } from "../packages/web/src/v3/world25Data.ts";
import { buildGalaxy, MIN_PRODUCED, panelsAt, planetOf, planetPos, routesOf } from "../packages/web/src/galaxy/galaxyData.ts";
import type { RequestRow } from "../packages/schema/src/payload.ts";

describe("towns the owner hid (D27 A3)", () => {
  it("draw no planet and take no orbit, still have a city to open, and are counted apart", () => {
    const p = demoPayload();
    const target = [...p.towns].filter((t) => t.kind === "project").sort((a, b) => b.counts.produced - a.counts.produced)[0];
    const towns = p.towns.map((t) => (t.key === target.key ? { ...t, hidden: true } : t));
    const w = buildWorld25(towns, p.requests, manifest as Manifest);
    const g = buildGalaxy(w);
    expect(g.planets.has(target.key)).toBe(false);
    expect(g.hiddenPlanets.get(target.key)?.town.key).toBe(target.key);
    expect(planetOf(g, target.key)?.key).toBe(target.key);
    const sys = g.systems.find((s) => s.faction === target.faction)!;
    expect(sys.planets.some((x) => x.key === target.key)).toBe(false);
    expect(sys.ownerHidden).toBe(1);
    expect(g.routes.every((r) => r.a !== target.key && r.b !== target.key)).toBe(true);
  });
});

describe("the star-system view on the demo", () => {
  const p = demoPayload();
  const w = buildWorld25(p.towns, p.requests, manifest as Manifest);
  const g = buildGalaxy(w);

  it("a planet for every town with at least MIN_PRODUCED finished products or work going on; the rest are counted as hidden", () => {
    const busy = new Set(p.requests.filter((r) => w.live.has(r.requestId)).map((r) => `${r.faction}|${r.projectId}`));
    const shown = p.towns.filter((t) => t.counts.produced >= MIN_PRODUCED || busy.has(t.key));
    expect(new Set(g.planets.keys())).toEqual(new Set(shown.map((t) => t.key)));
    expect(g.systems.reduce((a, s) => a + s.hidden, 0)).toBe(p.towns.length - shown.length);
  });

  it("each planet circles its own faction's star; the stars sit apart", () => {
    for (const s of g.systems) for (const pl of s.planets) expect(pl.town.faction).toBe(s.faction);
    if (g.systems.length === 2) expect(g.systems[0].x).toBeLessThan(g.systems[1].x);
  });

  it("orbits never touch: each planet clears its inner neighbour and the Dyson shell", () => {
    for (const s of g.systems) {
      expect(s.planets[0].orbit - s.planets[0].radius).toBeGreaterThan(s.shellRadius);
      for (let i = 1; i < s.planets.length; i++) {
        const a = s.planets[i - 1], b = s.planets[i];
        expect(b.orbit - b.radius).toBeGreaterThan(a.orbit + a.radius);
      }
    }
  });

  it("every drawn spot of a shown town but props becomes a block on its planet, on the planet's surface", () => {
    for (const pl of g.planets.values()) {
      const spots = w.layouts.get(pl.key)!.spots.filter((s) => s.info.kind !== "prop");
      expect(pl.blocks.length).toBe(spots.length);
      for (const b of pl.blocks) expect(Math.hypot(...b.dir)).toBeCloseTo(1, 6);
    }
  });

  it("a Dyson panel per finished product, counted up to the moment asked", () => {
    for (const s of g.systems) {
      const produced = p.requests.filter((r) => r.faction === s.faction && r.class === "produced");
      expect(s.panels.length).toBe(produced.length);
      expect(panelsAt(s, -Infinity)).toBe(0);
      expect(panelsAt(s, Infinity)).toBe(produced.length);
      if (s.panels.length) expect(panelsAt(s, s.panels[0])).toBeGreaterThanOrEqual(1);
    }
  });

  it("a planet stays on its orbit as time goes by", () => {
    const s = g.systems[0];
    const pl = s.planets[0];
    for (const t of [0, 13.7, 999]) {
      const [x, y, z] = planetPos(pl, s, t);
      expect(Math.hypot(x - s.x, y, z - s.z)).toBeCloseTo(pl.orbit, 6);
    }
  });
});

describe("trade routes", () => {
  const row = (sessionId: string, projectId: string, startTs: number, faction: "claude-code" | "codex" = "codex"): RequestRow =>
    ({ requestId: `${sessionId}-${startTs}`, sessionId, projectId, faction, startTs, endTs: startTs + 1 }) as RequestRow;

  it("count a session moving between two towns, either way round, and nothing else", () => {
    const r = routesOf([row("s1", "/a", 1), row("s1", "/b", 2), row("s1", "/a", 3), row("s1", "/a", 4), row("s2", "/c", 1)]);
    expect(r).toEqual([{ faction: "codex", a: "codex|/a", b: "codex|/b", count: 2 }]);
  });

  it("follow time order, not the order the rows came in", () => {
    const r = routesOf([row("s1", "/b", 2), row("s1", "/a", 1), row("s1", "/b", 3)]);
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(1);
  });

  it("keep at most the busiest routes per faction", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [row(`s${i}`, "/hub", 0), row(`s${i}`, `/p${i}`, 1)]).flat();
    expect(routesOf(rows, 3)).toHaveLength(3);
  });

  it("an empty world has no routes", () => {
    expect(routesOf([])).toEqual([]);
  });
});
