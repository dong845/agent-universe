// One town's island (spec v3 5, 8.3; the look the owner approved in the 2026-10-29 demo): a square with
// the landmark, the task hall and the notice board; the kinds of work done here on a ring around it;
// one wedge per top folder, where the main finished work stands as houses; the biggest investigations
// as tents on the edge. Everything else is counted, not drawn. Pure and deterministic.
import type { RequestRow } from "../../../schema/src/payload.ts";
import type { TownRow } from "../../../schema/src/towns.ts";
import type { ArtQuery } from "./art.ts";
import { t } from "../i18n/index.ts";

export interface LayoutConfig {
  maxHouses: number;
  maxTents: number;
  /** a kind of work needs this many calls in the town to get its building */
  minWork: number;
  tiers: [number, number, number];
  maxStreets: number;
  /** requests in progress: always drawn, as a house under construction */
  live?: Set<string>;
}

export const LAYOUT_DEFAULTS: LayoutConfig = { maxHouses: 20, maxTents: 6, minWork: 5, tiers: [1, 10, 40], maxStreets: 6 };

export type SpotInfo =
  | { kind: "house" | "tent"; requestId: string }
  | { kind: "public"; work: string; count: number }
  | { kind: "landmark"; tier: 1 | 2 | 3 }
  | { kind: "hall" }
  | { kind: "notice"; chats: number }
  | { kind: "prop" };

export interface Spot {
  art: ArtQuery;
  /** town-local position on the ground */
  x: number;
  z: number;
  /** footprint width in world units */
  size: number;
  /** the hex cell, "q,r" */
  cell: string;
  /** a request still in progress */
  live?: boolean;
  info: SpotInfo;
  /** shown from this time on (the request's end; the moment the landmark reached its tier) */
  from?: number;
  /** and until this time (a landmark tier replaced by the next) */
  until?: number;
  street?: string;
}

export interface Street {
  name: string;
  /** where its sign stands */
  x: number;
  z: number;
  drawn: number;
  minor: number;
}

export interface TownLayout {
  cells: { q: number; r: number; kind: "grass" | "plaza" | "street" | "lot" }[];
  spots: Spot[];
  streets: Street[];
  /** world units from the centre to the outer edge of the island */
  radius: number;
}

/** role (and spawn/compaction) → the public building's art name */
export const WORK_ART: Record<string, string> = {
  scout: "read", smith: "edit", engineer: "run", inspector: "test", messenger: "online", diplomat: "external",
  scribe: "plan", painter: "image", operator: "screen", spawn: "spawn", compaction: "compact",
};
/** plain names for the public buildings (owner 2026-10-28) */
export const WORK_NAMES: Record<string, string> = {
  scout: t("work.scout"), smith: t("work.smith"), engineer: t("work.engineer"), inspector: t("work.inspector"), messenger: t("work.messenger"), diplomat: t("work.diplomat"),
  scribe: t("work.scribe"), painter: t("work.painter"), operator: t("work.operator"), spawn: t("work.spawn"), compaction: t("work.compaction"),
};

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;
export const cellPos = (q: number, r: number) => ({ x: 2 * (q + r / 2), z: Math.sqrt(3) * r });
const ringDist = (q: number, r: number) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
export function ring(n: number): [number, number][] {
  if (n === 0) return [[0, 0]];
  const out: [number, number][] = [];
  let q = DIRS[4][0] * n, r = DIRS[4][1] * n;
  for (let side = 0; side < 6; side++) for (let i = 0; i < n; i++) { out.push([q, r]); q += DIRS[side][0]; r += DIRS[side][1]; }
  return out;
}
export function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
const work = (r: RequestRow) => r.tokens.input + r.tokens.output + r.tokens.cacheWrite;
export const streetOf = (d: string | null) => (d === null ? t("street.other") : d === "." ? t("street.root") : d);
/** a street's sign: "<folder> 街", but the loose files and the root folder are named as they are (D27 B5) */
export const streetTitle = (name: string) => (name === t("street.other") ? t("street.otherFiles") : name === t("street.root") ? t("street.rootFiles") : t("city.street", { name }));

export function layoutTown(town: TownRow, requests: RequestRow[], cfg: LayoutConfig): TownLayout {
  const cells = new Map<string, { q: number; r: number; kind: TownLayout["cells"][number]["kind"] }>();
  const take = (q: number, r: number, kind: TownLayout["cells"][number]["kind"]) => cells.set(`${q},${r}`, { q, r, kind });
  const free = (q: number, r: number) => !cells.has(`${q},${r}`);
  const spots: Spot[] = [];
  const at = (q: number, r: number) => ({ ...cellPos(q, r), cell: `${q},${r}` });

  const mine = requests.filter((r) => `${r.faction}|${r.projectId}` === town.key).sort((a, b) => a.endTs - b.endTs || (a.requestId < b.requestId ? -1 : 1));
  const isLive = (r: RequestRow) => cfg.live?.has(r.requestId) ?? false;
  // a request in progress stands as a house from its start, whatever it has made so far
  const produced = mine.filter((r) => r.class === "produced" || isLive(r));
  const investigations = mine.filter((r) => r.class === "investigation" && !isLive(r));
  const chats = mine.filter((r) => r.class === "chat" || r.class === "empty").length;

  // ---- the square: landmark (by tiers of finished work), task hall, notice board ----------------
  take(0, 0, "lot");
  if (produced.length) {
    const fixed = town.kind === "capital" || town.kind === "outpost";
    const tiers = fixed ? [1] : cfg.tiers.map((_, i) => i + 1).filter((t) => produced.length >= cfg.tiers[t - 1]);
    tiers.forEach((t, i) => {
      const reached = produced[cfg.tiers[t - 1] - 1] ?? produced[0];
      const next = tiers[i + 1] ? produced[cfg.tiers[tiers[i + 1] - 1] - 1] : undefined;
      const art: ArtQuery = fixed ? { category: "misc", name: town.kind === "capital" ? `capital_${town.faction}` : "outpost" } : { category: "landmark", theme: town.theme, tier: t as 1 | 2 | 3 };
      spots.push({ art, ...at(0, 0), z: cellPos(0, 0).z - 0.9, size: 2.6, info: { kind: "landmark", tier: t as 1 | 2 | 3 }, from: fixed ? produced[0].endTs : reached.endTs, until: next?.endTs });
    });
  }
  for (const [q, r] of ring(1)) take(q, r, "plaza");
  take(-1, 0, "lot");
  spots.push({ art: { category: "public", work: "hall", faction: town.faction }, ...at(-1, 0), size: 1.8, info: { kind: "hall" } });
  take(1, 0, "lot");
  spots.push({ art: { category: "misc", name: "notice" }, ...at(1, 0), size: 1.1, info: { kind: "notice", chats } });
  spots.push({ art: { category: "prop", name: "lamp_crates" }, ...at(0, 1), size: 0.8, info: { kind: "prop" } });
  for (const [q, r] of ring(2)) take(q, r, "plaza");

  // ---- the kinds of work done here, evenly on ring 3 ---------------------------------------------
  const works = Object.keys(WORK_ART).filter((k) => (town.workCounts[k] ?? 0) >= cfg.minWork);
  const r3 = ring(3);
  works.forEach((k, i) => {
    const [q, r] = r3[Math.round((i * r3.length) / works.length) % r3.length];
    take(q, r, "lot");
    const n = town.workCounts[k];
    spots.push({ art: { category: "public", work: WORK_ART[k], faction: town.faction }, ...at(q, r), size: n >= 1000 ? 1.95 : n >= 100 ? 1.75 : 1.55, info: { kind: "public", work: k, count: n } });
  });
  for (const [q, r] of r3) if (free(q, r)) take(q, r, "plaza");

  // ---- streets: one wedge per top folder; the biggest finished work stands, the rest is counted ----
  const byFolder = new Map<string, number>();
  for (const r of produced) byFolder.set(streetOf(r.topDir), (byFolder.get(streetOf(r.topDir)) ?? 0) + 1);
  let names = [...byFolder.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
  if (names.length > cfg.maxStreets) names = [...names.filter((n) => n !== t("street.other")).slice(0, cfg.maxStreets - 1), t("street.other")];
  const streetName = (r: RequestRow) => (names.includes(streetOf(r.topDir)) ? streetOf(r.topDir) : t("street.other"));
  // work in progress first (most recent first), then the larger half of the finished work, at most maxHouses in all
  const liveOnes = produced.filter(isLive).sort((a, b) => b.startTs - a.startTs || (a.requestId < b.requestId ? -1 : 1)).slice(0, cfg.maxHouses);
  const done = produced.filter((r) => !isLive(r));
  const room = Math.max(0, Math.min(cfg.maxHouses - liveOnes.length, Math.ceil(done.length / 2)));
  const keep = new Set([...liveOnes, ...done.sort((a, b) => work(b) - work(a) || (a.requestId < b.requestId ? -1 : 1)).slice(0, room)].map((r) => r.requestId));
  const drawnWork = produced.filter((r) => keep.has(r.requestId)).map(work).sort((a, b) => a - b);
  const sizeOf = (w: number) => (w >= drawnWork[Math.floor(drawnWork.length * 0.8)] ? 1.5 : w >= drawnWork[Math.floor(drawnWork.length * 0.4)] ? 1.28 : 1.08);
  const streets: Street[] = [];
  const angle = (q: number, r: number) => { const p = cellPos(q, r); return Math.atan2(-p.z, p.x); };
  names.forEach((name, i) => {
    const mid = -Math.PI / 2 + (i * 2 * Math.PI) / names.length;
    const width = (2 * Math.PI) / names.length;
    const inWedge = (q: number, r: number) => { const d = angle(q, r) - mid; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) <= width / 2 - 1e-6; };
    const onLine = (q: number, r: number) => { const p = cellPos(q, r); return p.x * Math.cos(mid) - p.z * Math.sin(mid) > 0 && Math.abs(p.x * Math.sin(mid) + p.z * Math.cos(mid)) < 1.1; };
    const all = produced.filter((r) => streetName(r) === name);
    const drawn = all.filter((r) => keep.has(r.requestId));
    const slots: [number, number][] = [];
    let sign: { x: number; z: number } | null = null;
    for (let n = 4; slots.length < drawn.length && n < 24; n++) {
      for (const [q, r] of ring(n)) {
        if (!free(q, r) || !inWedge(q, r)) continue;
        if (onLine(q, r)) { take(q, r, "street"); sign ??= cellPos(q, r); continue; }
        slots.push([q, r]);
      }
    }
    sign ??= { x: 8 * Math.cos(mid) * Math.sqrt(3), z: -8 * Math.sin(mid) * Math.sqrt(3) };
    drawn.forEach((r, j) => {
      if (!slots[j]) return; // no room left in the wedge: counted, not drawn
      const [q, rr] = slots[j];
      take(q, rr, "lot");
      const p = at(q, rr);
      spots.push({
        art: { category: "house", theme: town.theme, kind: r.productKind ?? "code", variant: hash(r.requestId) < 0.5 ? "a" : "b" },
        ...p, x: p.x + (hash(r.requestId, 1) - 0.5) * 0.3, z: p.z + (hash(r.requestId, 2) - 0.5) * 0.3,
        size: isLive(r) ? 1.28 : sizeOf(work(r)), info: { kind: "house", requestId: r.requestId }, from: isLive(r) ? r.startTs : r.endTs, street: name, ...(isLive(r) ? { live: true } : {}),
      });
    });
    const placed = Math.min(drawn.length, slots.length);
    streets.push({ name, x: sign.x, z: sign.z, drawn: placed, minor: all.length - placed });
  });

  // ---- tents for the biggest investigations, on the outskirts --------------------------------------
  let maxRing = 3;
  for (const c of cells.values()) maxRing = Math.max(maxRing, ringDist(c.q, c.r));
  const tents = investigations.slice().sort((a, b) => b.calls - a.calls || (a.requestId < b.requestId ? -1 : 1)).slice(0, cfg.maxTents).sort((a, b) => a.endTs - b.endTs || (a.requestId < b.requestId ? -1 : 1));
  const edge = ring(maxRing + 1).filter(([q, r]) => free(q, r));
  tents.forEach((t, i) => {
    const [q, r] = edge[Math.round((i * edge.length) / Math.max(tents.length, 1)) % edge.length];
    take(q, r, "lot");
    spots.push({ art: { category: "misc", name: hash(t.requestId) < 0.5 ? "tent_a" : "tent_b" }, ...at(q, r), size: 1.15, info: { kind: "tent", requestId: t.requestId }, from: t.endTs });
  });
  if (tents.length) maxRing += 1;

  // ---- the island: everything used plus a ragged margin; trees towards the coast -------------------
  const R = maxRing + 1;
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    if (!free(q, r)) continue;
    const d = ringDist(q, r);
    if (d <= R - 0.5 + hash(`${town.key}|${q},${r}`, 3) * 1.2 && d <= R) take(q, r, "grass");
  }
  for (const c of cells.values()) {
    if (c.kind !== "grass") continue;
    const h = hash(`${town.key}|${c.q},${c.r}`, 4);
    if (ringDist(c.q, c.r) >= maxRing - 1 && h < 0.3) {
      const p = at(c.q, c.r);
      spots.push({ art: { category: "prop", name: h < 0.15 ? "tree_round" : "tree_cypress" }, ...p, x: p.x + (hash(c.q + "," + c.r, 5) - 0.5) * 0.8, z: p.z + (hash(c.q + "," + c.r, 6) - 0.5) * 0.8, size: 0.85 + hash(c.q + "," + c.r, 7) * 0.35, info: { kind: "prop" } });
    }
  }
  return { cells: [...cells.values()], spots, streets, radius: (R + 0.6) * 2 };
}
