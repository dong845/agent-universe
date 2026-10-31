// Everything the 2.5D world draws, from the payload's towns and requests (spec v3 8): each town's
// layout, its island's place, its landmark idea, and the sprite every spot resolves to. Pure.
import type { RequestRow } from "../../../schema/src/payload.ts";
import type { TownRow } from "../../../schema/src/towns.ts";
import { placeIslands } from "./archipelago.ts";
import { assignIdeas, resolveArt, type Manifest, type ResolvedArt } from "./art.ts";
import { LAYOUT_DEFAULTS, layoutTown, type Spot, type TownLayout } from "./townLayout.ts";

export interface World25 {
  towns: Map<string, TownRow>;
  requests: Map<string, RequestRow>;
  layouts: Map<string, TownLayout>;
  centers: Map<string, { x: number; z: number }>;
  /** the sprite for each spot; missing when nothing can stand in (that spot is not drawn) */
  resolved: Map<Spot, ResolvedArt>;
}

export function buildWorld25(towns: TownRow[], requests: RequestRow[], manifest: Manifest): World25 {
  const byTown = new Map<string, RequestRow[]>();
  for (const r of requests) {
    const k = `${r.faction}|${r.projectId}`;
    byTown.set(k, [...(byTown.get(k) ?? []), r]);
  }
  const ideas = assignIdeas(towns.filter((t) => t.kind === "project" || t.kind === "guild"));
  const layouts = new Map<string, TownLayout>();
  const resolved = new Map<Spot, ResolvedArt>();
  for (const t of towns) {
    const l = layoutTown(t, byTown.get(t.key) ?? [], LAYOUT_DEFAULTS);
    for (const s of l.spots) {
      if (s.art.category === "landmark") s.art = { ...s.art, idea: ideas.get(t.key) ?? 1 };
      const a = resolveArt(manifest, s.art);
      if (a) resolved.set(s, a);
    }
    layouts.set(t.key, l);
  }
  const centers = placeIslands(towns.map((t) => ({ key: t.key, faction: t.faction, kind: t.kind, radius: layouts.get(t.key)!.radius, weight: t.counts.produced })));
  return { towns: new Map(towns.map((t) => [t.key, t])), requests: new Map(requests.map((r) => [r.requestId, r])), layouts, centers, resolved };
}

export interface Placed {
  spot: Spot;
  town: string;
  /** world position of the spot's footprint */
  x: number;
  z: number;
}

/** the spots standing at absolute time `ts`, grouped by sprite id */
export function spritesAt(w: World25, ts: number): Map<string, Placed[]> {
  const out = new Map<string, Placed[]>();
  for (const [key, l] of w.layouts) {
    const c = w.centers.get(key)!;
    for (const s of l.spots) {
      if ((s.from !== undefined && s.from > ts) || (s.until !== undefined && s.until <= ts)) continue;
      const a = w.resolved.get(s);
      if (!a) continue;
      const list = out.get(a.id) ?? [];
      list.push({ spot: s, town: key, x: c.x + s.x, z: c.z + s.z });
      out.set(a.id, list);
    }
  }
  return out;
}
