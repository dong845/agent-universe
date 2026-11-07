// The star-system view (spike, owner 2026-11-01 "类似戴森球"): every faction is a star, every town a
// planet on its own orbit, the town's main work a city on the planet's top. All positions come from
// the same town layouts the 2.5D world uses, so both views show the same buildings. Pure.
import type { Faction } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";
import type { TownRow } from "../../../schema/src/towns.ts";
import { hash, type Spot } from "../v3/townLayout.ts";
import type { World25 } from "../v3/world25Data.ts";

export type BlockType = "house" | "tent" | "public" | "landmark" | "hall" | "notice";
type V3 = [number, number, number];

export interface Block {
  spot: Spot;
  type: BlockType;
  /** unit direction from the planet's centre, planet-local; +Y is the middle of the city */
  dir: V3;
  /** footprint and height, world units */
  foot: number;
  height: number;
  /** turn about the local up axis */
  turn: number;
  color: string;
  live: boolean;
  from?: number;
  until?: number;
}

export interface Belt {
  a: V3;
  b: V3;
  color: string;
  /** light dots per world unit of belt: more calls, denser */
  density: number;
}

export type PlanetKind = "rock" | "ice" | "gas" | "lava" | "ocean" | "moon";
export interface PlanetLook {
  kind: PlanetKind;
  a: string;
  b: string;
  c: string;
  atmo: string;
}

export interface Planet {
  key: string;
  town: TownRow;
  radius: number;
  orbit: number;
  phase: number;
  /** seconds for one revolution */
  period: number;
  incline: number;
  look: PlanetLook;
  /** finished work reached the third landmark tier */
  ring: boolean;
  blocks: Block[];
  belts: Belt[];
  live: boolean;
  seed: number;
  /** world units per layout unit at the surface (the city view draws the layout at 1) */
  unit: number;
}

export interface StarSystem {
  faction: Faction;
  x: number;
  z: number;
  radius: number;
  shellRadius: number;
  color: string;
  /** end time of every finished product, oldest first: one Dyson panel each */
  panels: number[];
  planets: Planet[];
  /** towns of this faction not drawn as planets (too little made there; still counted in `panels`) */
  hidden: number;
  /** towns the owner hid from space (D27 A3); also still counted in `panels` */
  ownerHidden: number;
}

export interface Route {
  faction: Faction;
  a: string;
  b: string;
  /** times one session moved between these two towns */
  count: number;
}

export interface Galaxy {
  systems: StarSystem[];
  /** the planets drawn in space */
  planets: Map<string, Planet>;
  /** towns the owner hid (D27 A3): no planet in space, but a city that search can still open */
  hiddenPlanets: Map<string, Planet>;
  routes: Route[];
}

/** a town's planet, drawn or hidden: what a city is built from */
export const planetOf = (g: Galaxy, key: string): Planet | undefined => g.planets.get(key) ?? g.hiddenPlanets.get(key);

export const FACTION_COLOR: Record<Faction, string> = { "claude-code": "#ff9a5c", codex: "#6cc3ff" };
export const PRODUCT_COLOR: Record<string, string> = { code: "#4fe3ff", docs: "#ffc857", slides: "#ff7ab6", image: "#b98cff", video: "#ff5e5e", data: "#5ef2a0" };
export const WORK_COLOR: Record<string, string> = {
  scout: "#7fd1ff", smith: "#ffb347", engineer: "#ff6f61", inspector: "#7cff9e", messenger: "#5ec8ff", diplomat: "#c58bff",
  scribe: "#ffe66d", painter: "#ff8fd8", operator: "#9ef0ff", spawn: "#ffffff", compaction: "#a0a8ff",
};

/** each theme gets its own kind of world (owner 2026-10-29: every town looks different) */
const LOOKS: Record<string, PlanetLook> = {
  capital: { kind: "rock", a: "#6b5a3e", b: "#c9a86a", c: "#efe2b8", atmo: "#ffd27a" },
  outpost: { kind: "moon", a: "#3c3f46", b: "#7b7f88", c: "#b9bcc3", atmo: "#9aa4b8" },
  publishing: { kind: "ice", a: "#3d6f9e", b: "#a9d3ef", c: "#f4fbff", atmo: "#9fdcff" },
  film: { kind: "lava", a: "#2a0d14", b: "#8c1d36", c: "#ff7a3d", atmo: "#ff9a6a" },
  music: { kind: "gas", a: "#3b2a6b", b: "#9b7be0", c: "#f2c4ff", atmo: "#c9a2ff" },
  talent: { kind: "ocean", a: "#0b3d4a", b: "#2a9d8f", c: "#e9f5c9", atmo: "#7ff0dc" },
  harbor: { kind: "ocean", a: "#0a2a5e", b: "#3f8fd2", c: "#e8f3ff", atmo: "#7cc4ff" },
  stargazer: { kind: "gas", a: "#141a4a", b: "#4b5bd6", c: "#c8d0ff", atmo: "#8fa0ff" },
  exchange: { kind: "rock", a: "#123a2a", b: "#3fa66b", c: "#d8f5c0", atmo: "#8affc0" },
  toyworks: { kind: "gas", a: "#6b2d12", b: "#f08a3c", c: "#ffe2b0", atmo: "#ffb070" },
  craftsmen: { kind: "rock", a: "#4a2a1c", b: "#b0643a", c: "#e8c39a", atmo: "#ffb48a" },
};
export const lookOf = (theme: string): PlanetLook => LOOKS[theme] ?? LOOKS.craftsmen;

/** how far from the city's middle (radians) the outermost building of a layout stands */
export const CAP = 1.0;
const RANK = { capital: 0, guild: 1, project: 2, outpost: 3 } as const;
/** owner 2026-11-01: a town with fewer finished products than this is not drawn, unless work is going on there */
export const MIN_PRODUCED = 2;

const toDir = (x: number, z: number, layoutR: number): V3 => {
  const d = Math.hypot(x, z);
  const th = (d / layoutR) * CAP;
  const az = Math.atan2(z, x);
  return [Math.sin(th) * Math.cos(az), Math.cos(th), Math.sin(th) * Math.sin(az)];
};

export const planetRadius = (produced: number) => Math.min(6.2, 1.5 + 0.62 * Math.log2(1 + produced));

function blocksOf(w: World25, town: TownRow, r: number): { blocks: Block[]; belts: Belt[] } {
  const l = w.layouts.get(town.key)!;
  const unit = (CAP * r) / l.radius; // world units per layout unit, at the surface
  const blocks: Block[] = [];
  for (const s of l.spots) {
    const i = s.info;
    if (i.kind === "prop") continue;
    const dir = toDir(s.x, s.z, l.radius);
    const foot = s.size * unit * 0.9;
    const turn = hash(s.cell + town.key) * Math.PI;
    if (i.kind === "house") {
      const req = w.requests.get(i.requestId);
      blocks.push({ spot: s, type: "house", dir, foot, height: foot * (1.15 + (s.size - 1) * 3.4), turn, color: PRODUCT_COLOR[req?.productKind ?? "code"] ?? PRODUCT_COLOR.code, live: !!s.live, from: s.from, until: s.until });
    } else if (i.kind === "tent") blocks.push({ spot: s, type: "tent", dir, foot, height: foot * 0.5, turn, color: "#bfe8ff", live: false, from: s.from });
    else if (i.kind === "public") blocks.push({ spot: s, type: "public", dir, foot, height: foot * (1.3 + Math.log10(Math.max(10, i.count)) * 0.45), turn, color: WORK_COLOR[i.work] ?? "#ffffff", live: false });
    else if (i.kind === "landmark") blocks.push({ spot: s, type: "landmark", dir, foot, height: foot * (1.6 + i.tier * 0.9), turn, color: FACTION_COLOR[town.faction], live: false, from: s.from, until: s.until });
    else if (i.kind === "hall") blocks.push({ spot: s, type: "hall", dir, foot, height: foot * 0.42, turn, color: FACTION_COLOR[town.faction], live: false });
    else if (i.kind === "notice") blocks.push({ spot: s, type: "notice", dir, foot, height: foot * 1.4, turn, color: "#ffe66d", live: false });
  }
  const hub = blocks.find((b) => b.type === "hall");
  const belts: Belt[] = [];
  if (hub) {
    for (const b of blocks) {
      if (b.type === "public") {
        const n = (b.spot.info as { count: number }).count;
        belts.push({ a: b.dir, b: hub.dir, color: b.color, density: 0.6 + Math.log10(Math.max(1, n)) * 0.9 });
      } else if (b.type === "house" || b.type === "tent") {
        const req = w.requests.get((b.spot.info as { requestId: string }).requestId);
        belts.push({ a: b.dir, b: hub.dir, color: b.color, density: 0.4 + Math.log10(Math.max(1, req?.calls ?? 1)) * 0.7 });
      }
    }
  }
  return { blocks, belts };
}

/** sessions that moved from one town to another: the trade routes between planets */
export function routesOf(requests: Iterable<RequestRow>, max = 40): Route[] {
  const bySession = new Map<string, RequestRow[]>();
  for (const r of requests) bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);
  const counts = new Map<string, Route>();
  for (const list of bySession.values()) {
    list.sort((a, b) => a.startTs - b.startTs);
    for (let i = 1; i < list.length; i++) {
      const p = list[i - 1], q = list[i];
      if (p.projectId === q.projectId || p.faction !== q.faction) continue;
      const [a, b] = [`${p.faction}|${p.projectId}`, `${q.faction}|${q.projectId}`].sort();
      const k = `${a}~${b}`;
      const r = counts.get(k) ?? { faction: p.faction, a, b, count: 0 };
      r.count++;
      counts.set(k, r);
    }
  }
  const out: Route[] = [];
  for (const f of ["claude-code", "codex"] as const) out.push(...[...counts.values()].filter((r) => r.faction === f).sort((a, b) => b.count - a.count || (a.a + a.b < b.a + b.b ? -1 : 1)).slice(0, max));
  return out;
}

/**
 * The planets and stars of the last galaxy built, kept while nothing they are made from changes (spec
 * 2026-11-03 A2): the same objects come back, so the scene keeps their meshes and materials.
 */
const planetCache = new Map<string, { sig: string; layout: object; planet: Planet }>();
const systemCache = new Map<string, StarSystem>();

export function buildGalaxy(w: World25): Galaxy {
  const systems: StarSystem[] = [];
  const planets = new Map<string, Planet>();
  const hiddenPlanets = new Map<string, Planet>();
  const sides: StarSystem[] = [];
  const busy = new Set([...w.requests.values()].filter((r) => w.live.has(r.requestId)).map((r) => `${r.faction}|${r.projectId}`));
  for (const faction of ["claude-code", "codex"] as const) {
    const all = [...w.towns.values()].filter((t) => t.faction === faction);
    const qualifies = (t: TownRow) => t.counts.produced >= MIN_PRODUCED || busy.has(t.key);
    const mine = all.filter((t) => qualifies(t) && t.hidden);
    const towns = all.filter((t) => qualifies(t) && !t.hidden).sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.counts.produced - a.counts.produced || (a.key < b.key ? -1 : 1));
    if (!all.length) continue;
    const produced = [...w.requests.values()].filter((r) => r.faction === faction && r.class === "produced").map((r) => r.endTs).sort((a, b) => a - b);
    const radius = 5 + 0.55 * Math.log2(1 + produced.length);
    const shellRadius = radius * 2.1;
    const list: Planet[] = [];
    let orbit = shellRadius + 7;
    let prev = 0;
    towns.forEach((t, i) => {
      const r = planetRadius(t.counts.produced);
      orbit += i === 0 ? r : prev + r + 2.6;
      prev = r;
      const layout = w.layouts.get(t.key)!;
      const sig = JSON.stringify([t, r, orbit, i, shellRadius]);
      const hit = planetCache.get(t.key);
      if (hit && hit.sig === sig && hit.layout === layout) {
        list.push(hit.planet);
        return;
      }
      const { blocks, belts } = blocksOf(w, t, r);
      const seed = hash(t.key) * 100;
      list.push({
        key: t.key, town: t, radius: r, orbit,
        phase: i * 2.39996 + hash(t.key, 9) * 0.6,
        period: 240 * Math.pow(orbit / (shellRadius + 7), 1.25),
        incline: (hash(t.key, 3) - 0.5) * 0.12,
        look: lookOf(t.kind === "capital" ? "capital" : t.kind === "outpost" ? "outpost" : t.theme),
        ring: t.kind !== "capital" && t.kind !== "outpost" && t.counts.produced >= 40,
        blocks, belts, live: blocks.some((b) => b.live), seed, unit: (CAP * r) / w.layouts.get(t.key)!.radius,
      });
      planetCache.set(t.key, { sig, layout, planet: list[list.length - 1] });
    });
    for (const t of mine) {
      const r = planetRadius(t.counts.produced);
      const { blocks, belts } = blocksOf(w, t, r);
      hiddenPlanets.set(t.key, {
        key: t.key, town: t, radius: r, orbit: 0, phase: 0, period: 240, incline: 0,
        look: lookOf(t.kind === "capital" ? "capital" : t.kind === "outpost" ? "outpost" : t.theme),
        ring: false, blocks, belts, live: blocks.some((b) => b.live), seed: hash(t.key) * 100, unit: (CAP * r) / w.layouts.get(t.key)!.radius,
      });
    }
    const prevSys = systemCache.get(faction);
    const same = prevSys && prevSys.radius === radius && prevSys.hidden === all.length - towns.length - mine.length && prevSys.ownerHidden === mine.length && prevSys.planets.length === list.length && prevSys.planets.every((q, j) => q === list[j]) && prevSys.panels.length === produced.length && prevSys.panels.every((v, j) => v === produced[j]);
    const sys: StarSystem = same ? prevSys : { faction, x: 0, z: 0, radius, shellRadius, color: FACTION_COLOR[faction], panels: produced, planets: list, hidden: all.length - towns.length - mine.length, ownerHidden: mine.length };
    systemCache.set(faction, sys);
    for (const p of list) planets.set(p.key, p);
    sides.push(sys);
  }
  // the two stars sit apart by their outermost orbits plus open space
  const reach = (s: StarSystem) => (s.planets.length ? s.planets[s.planets.length - 1].orbit + s.planets[s.planets.length - 1].radius : s.shellRadius);
  if (sides.length === 2) {
    sides[0].x = -(reach(sides[0]) + 18);
    sides[1].x = reach(sides[1]) + 18;
  }
  systems.push(...sides);
  return { systems, planets, hiddenPlanets, routes: routesOf(w.requests.values()).filter((r) => planets.has(r.a) && planets.has(r.b)) };
}

/** where a planet is at time `sec` (seconds of the orbit clock) */
export function planetPos(p: Planet, s: StarSystem, sec: number): V3 {
  const a = p.phase + (2 * Math.PI * sec) / p.period;
  const x = Math.cos(a) * p.orbit, z = Math.sin(a) * p.orbit;
  return [s.x + x, z * Math.sin(p.incline), s.z + z * Math.cos(p.incline)];
}

/** the panels of a Dyson shell finished by `ts` */
export function panelsAt(s: StarSystem, ts: number): number {
  let lo = 0, hi = s.panels.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s.panels[m] <= ts) lo = m + 1;
    else hi = m;
  }
  return lo;
}
