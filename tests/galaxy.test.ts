import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import manifest from "../art/manifest.json" with { type: "json" };
import type { Manifest } from "../packages/web/src/v3/art.ts";
import { buildWorld25 } from "../packages/web/src/v3/world25Data.ts";
import { buildGalaxy, MIN_PRODUCED, panelsAt, planetOf, planetPos, routesOf } from "../packages/web/src/galaxy/galaxyData.ts";
import type { RequestRow } from "../packages/schema/src/payload.ts";

describe("one-off folders (D29): a project active on one day only draws no planet", () => {
  const DAY = 86_400_000, T0 = Date.UTC(2026, 9, 1, 10);
  const town = (name: string, produced: number) => ({ key: `codex|/w/${name}`, faction: "codex", projectId: `/w/${name}`, name, kind: "project", guildOf: [], theme: "craftsmen", counts: { produced, investigation: 0, chat: 0, empty: 0 }, workCounts: {}, lastEditTs: null }) as never;
  const req = (name: string, i: number, at: number, live = false): RequestRow => ({ requestId: `${name}-${i}`, faction: "codex", projectId: `/w/${name}`, sessionId: `s-${name}`, startTs: at - 60_000, endTs: at, ok: live ? null : true, class: "produced", productKind: "code", tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, calls: 1, fails: 0, spawns: 0, skills: [], topDir: "src", turns: 1, taskIds: [`T-${name}-${i}`] });
  const requests = [
    ...Array.from({ length: 9 }, (_, i) => req("deck", i, T0 + i * 600_000)),
    req("app", 0, T0), req("app", 1, T0 + 3 * DAY),
    req("today", 0, T0 + 5 * DAY), req("today", 1, T0 + 5 * DAY + 600_000, true),
  ];
  const w = buildWorld25([town("deck", 9), town("app", 2), town("today", 2)], requests, manifest as Manifest, new Set(["T-today-1"]));
  const g = buildGalaxy(w);
  it("nine finished pieces made in one day: no planet, still counted as not shown", () => {
    expect(g.planets.has("codex|/w/deck")).toBe(false);
    expect(g.systems[0].hidden).toBe(1);
    expect(g.systems[0].panels.length).toBe(9 + 2 + 2);
  });
  it("two finished pieces on two days: a planet; one day but work in progress: a planet", () => {
    expect(g.planets.has("codex|/w/app")).toBe(true);
    expect(g.planets.has("codex|/w/today")).toBe(true);
  });
});

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
