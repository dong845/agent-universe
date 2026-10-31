import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import manifest from "../art/manifest.json" with { type: "json" };
import type { Manifest } from "../packages/web/src/v3/art.ts";
import { buildWorld25, spritesAt } from "../packages/web/src/v3/world25Data.ts";

describe("buildWorld25 on the demo", () => {
  const p = demoPayload();
  const w = buildWorld25(p.towns, p.requests, manifest as Manifest);

  it("a layout and an island centre for every town", () => {
    expect(w.layouts.size).toBe(p.towns.length);
    for (const t of p.towns) expect(w.centers.get(t.key), t.key).toBeDefined();
  });

  it("every building resolves to a sprite; each sprite's instances are its spots", () => {
    const all = spritesAt(w, Infinity);
    const spots = [...w.layouts.values()].flatMap((l) => l.spots).filter((s) => s.until === undefined);
    const drawn = [...all.values()].reduce((a, g) => a + g.length, 0);
    const unresolved = spots.filter((s) => !w.resolved.get(s));
    expect(unresolved.filter((s) => s.info.kind !== "prop")).toEqual([]);
    expect(drawn).toBe(spots.length - unresolved.length);
  });

  it("before a request ended its house is not drawn", () => {
    const house = [...w.layouts.values()].flatMap((l) => l.spots).find((s) => s.info.kind === "house")!;
    const count = (t: number) => [...spritesAt(w, t).values()].flat().filter((x) => x.spot === house).length;
    expect(count(house.from! - 1)).toBe(0);
    expect(count(house.from!)).toBe(1);
  });

  it("only one landmark tier stands at a time", () => {
    const lm = [...w.layouts.values()].flatMap((l) => l.spots.filter((s) => s.info.kind === "landmark"));
    const t = Math.max(...lm.map((s) => s.from!)) + 1;
    const standing = [...spritesAt(w, t).values()].flat().filter((x) => x.spot.info.kind === "landmark");
    const perTown = new Map<string, number>();
    for (const x of standing) perTown.set(x.town, (perTown.get(x.town) ?? 0) + 1);
    expect([...perTown.values()].every((n) => n === 1)).toBe(true);
  });
});

describe("demo payload liveness", () => {
  it("only the live window's tasks are live, not the history", () => {
    const p = demoPayload();
    expect(p.liveTaskIds.length).toBeGreaterThan(0);
    const history = new Set(p.events.filter((e) => e.sessionId.endsWith(":history") && e.taskId).map((e) => e.taskId!));
    expect(p.liveTaskIds.some((id) => history.has(id))).toBe(false);
  });
});
