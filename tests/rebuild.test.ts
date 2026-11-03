// A newer world keeps the towns that did not change (spec 2026-11-03 A2): same layout and planet
// objects, so the page redraws only what changed.
import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import manifest from "../art/manifest.json" with { type: "json" };
import { buildWorld25 } from "../packages/web/src/v3/world25Data.ts";
import { buildGalaxy } from "../packages/web/src/galaxy/galaxyData.ts";
import type { Manifest } from "../packages/web/src/v3/art.ts";

const M = manifest as unknown as Manifest;

describe("incremental world rebuild", () => {
  it("an identical world keeps every layout and planet object", () => {
    const p = demoPayload();
    const a = buildWorld25(p.towns, p.requests, M);
    const b = buildWorld25(structuredClone(p.towns), structuredClone(p.requests), M);
    for (const [k, l] of a.layouts) expect(b.layouts.get(k), k).toBe(l);
    const ga = buildGalaxy(a), gb = buildGalaxy(b);
    for (const [k, pl] of ga.planets) expect(gb.planets.get(k), k).toBe(pl);
    expect(gb.systems[0]).toBe(ga.systems[0]);
  });
  it("a new request rebuilds only its own town", () => {
    const p = demoPayload();
    const a = buildWorld25(p.towns, p.requests, M);
    const ga = buildGalaxy(a);
    const town = p.towns.find((t) => t.counts.produced > 3)!;
    const r0 = p.requests.find((r) => `${r.faction}|${r.projectId}` === town.key && r.class === "produced")!;
    const extra = { ...r0, requestId: "brand-new", startTs: r0.endTs + 10, endTs: r0.endTs + 20 };
    const towns2 = p.towns.map((t) => (t.key === town.key ? { ...t, counts: { ...t.counts, produced: t.counts.produced + 1 } } : t));
    const b = buildWorld25(towns2, [...p.requests, extra], M);
    expect(b.layouts.get(town.key)).not.toBe(a.layouts.get(town.key));
    const others = [...a.layouts.keys()].filter((k) => k !== town.key && k.split("|")[0] === town.faction);
    expect(others.length).toBeGreaterThan(0);
    for (const k of others) expect(b.layouts.get(k), k).toBe(a.layouts.get(k));
    const gb = buildGalaxy(b);
    expect(gb.planets.get(town.key)).not.toBe(ga.planets.get(town.key));
    // the other faction did not change at all
    const other = [...ga.planets.keys()].find((k) => !k.startsWith(town.faction))!;
    expect(gb.planets.get(other)).toBe(ga.planets.get(other));
  });
});
