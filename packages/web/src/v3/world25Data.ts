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
  /** requests in progress */
  live: Set<string>;
}

/**
 * Each town's layout, kept while nothing it is built from changes (spec 2026-11-03 A2): a newer world
 * then hands back the same layout object, and the page redraws only the towns that did change.
 */
const layoutCache = new Map<string, { sig: string; layout: TownLayout; resolved: [Spot, ResolvedArt][] }>();
let islandCache: { sig: string; centers: Map<string, { x: number; z: number }> } | null = null;

export function buildWorld25(towns: TownRow[], requests: RequestRow[], manifest: Manifest, liveTasks: Set<string> = new Set()): World25 {
  const live = new Set(requests.filter((r) => r.taskIds.some((t) => liveTasks.has(t))).map((r) => r.requestId));
  const byTown = new Map<string, RequestRow[]>();
  for (const r of requests) {
    const k = `${r.faction}|${r.projectId}`;
    const l = byTown.get(k);
    if (l) l.push(r);
    else byTown.set(k, [r]);
  }
  const ideas = assignIdeas(towns.filter((t) => t.kind === "project" || t.kind === "guild"));
  const layouts = new Map<string, TownLayout>();
  const resolved = new Map<Spot, ResolvedArt>();
  const seen = new Set<string>();
  for (const t of towns) {
    const mine = byTown.get(t.key) ?? [];
    // everything the layout is made from: the town, its requests, which of them are live, its idea
    const sig = JSON.stringify([t, mine, mine.filter((r) => live.has(r.requestId)).map((r) => r.requestId), ideas.get(t.key) ?? 1]);
    seen.add(t.key);
    const hit = layoutCache.get(t.key);
    if (hit && hit.sig === sig) {
      layouts.set(t.key, hit.layout);
      for (const [spot, a] of hit.resolved) resolved.set(spot, a);
      continue;
    }
    const l = layoutTown(t, mine, { ...LAYOUT_DEFAULTS, live });
    const res: [Spot, ResolvedArt][] = [];
    for (const s of l.spots) {
      if (s.art.category === "landmark") s.art = { ...s.art, idea: ideas.get(t.key) ?? 1 };
      const a = resolveArt(manifest, s.art);
      if (a) {
        resolved.set(s, a);
        res.push([s, a]);
      }
    }
    layouts.set(t.key, l);
    layoutCache.set(t.key, { sig, layout: l, resolved: res });
  }
  for (const k of [...layoutCache.keys()]) if (!seen.has(k)) layoutCache.delete(k);
  const islands = towns.map((t) => ({ key: t.key, faction: t.faction, kind: t.kind, radius: layouts.get(t.key)!.radius, weight: t.counts.produced }));
  const isig = JSON.stringify(islands);
  if (!islandCache || islandCache.sig !== isig) islandCache = { sig: isig, centers: placeIslands(islands) };
  return { towns: new Map(towns.map((t) => [t.key, t])), requests: new Map(requests.map((r) => [r.requestId, r])), layouts, centers: islandCache.centers, resolved, live };
}

export interface Placed {
  spot: Spot;
  town: string;
  /** world position of the spot's footprint */
  x: number;
  z: number;
}

/** the spots standing at absolute time `ts`, grouped by sprite id (and "|live" for the ones in progress) */
export function spritesAt(w: World25, ts: number): Map<string, Placed[]> {
  const out = new Map<string, Placed[]>();
  for (const [key, l] of w.layouts) {
    const c = w.centers.get(key)!;
    for (const s of l.spots) {
      if ((s.from !== undefined && s.from > ts) || (s.until !== undefined && s.until <= ts)) continue;
      const a = w.resolved.get(s);
      if (!a) continue;
      const g = s.live ? `${a.id}|live` : a.id;
      const list = out.get(g) ?? [];
      list.push({ spot: s, town: key, x: c.x + s.x, z: c.z + s.z });
      out.set(g, list);
    }
  }
  return out;
}
