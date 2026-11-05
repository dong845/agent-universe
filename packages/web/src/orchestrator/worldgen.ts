// World layout from events (plan "世界布局"): two faction territories split by a river, one district
// per project placed by a hash of its path (stable between runs), sized in five tiers by its
// cumulative tokens, with one permanent house per finished task. Pure: the same events always
// give the same world.
import type { AgentTownEvent, Faction } from "../../../schema/src/event.ts";
import type { Vec } from "./layout.ts";
import { t as tx } from "../i18n/index.ts";

/** tier thresholds on a project's cumulative tokens (plan: 按对数增长分 5 级) */
export const TIER_TOKENS = [0, 3e6, 1e7, 3e7, 1e8] as const;
export const TIER_NAMES: readonly string[] = [tx("tier.0"), tx("tier.1"), tx("tier.2"), tx("tier.3"), tx("tier.4")];
/** plan: a bridge appears when the other faction starts work on the same path within 30 min */
export const BRIDGE_WINDOW_MS = 30 * 60_000;
/** where a district's houses begin, outside its ring of tool buildings */
export const HOUSE_RING = 13.2;
const HOUSE_STEP = 2.5;
/** houses kept per tier; older finished tasks are counted, not drawn */
export const HOUSES_PER_TIER = 14;

export interface House {
  taskId: string;
  at: Vec; // world position
  floors: number;
  /** null: the task stopped without a recorded end (not a success, not a failure) */
  ok: boolean | null;
  builtAt: number; // task_end timestamp, or the last event of a task that never ended
  tokens: number;
  title?: string;
}

export interface District {
  key: string; // faction + projectId
  faction: Faction;
  projectId: string;
  name: string;
  origin: Vec;
  tier: number;
  tokens: number;
  radius: number;
  houses: House[];
  /** finished tasks not drawn as houses (beyond the tier's cap) */
  olderTasks: number;
  /** has live, fully detailed events (tool calls) to animate */
  detailed: boolean;
}

/** one hand-over: `to`'s faction started on the path within the window after `from`'s finished */
export interface Crossing {
  from: string;
  to: string;
  at: number;
}

/** one physical bridge per pair of districts, standing from its first crossing on */
export interface Bridge {
  districts: [string, string];
  at: number;
  crossings: Crossing[];
  a: Vec;
  b: Vec;
}

export interface World {
  districts: District[];
  capitals: Record<Faction, Vec>;
  roads: { district: string; points: Vec[] }[];
  bridges: Bridge[];
  river: Vec[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const districtKey = (e: Pick<AgentTownEvent, "faction" | "projectId">) => `${e.faction}|${e.projectId}`;

export function tierOf(tokens: number): number {
  let t = 1;
  for (let i = 1; i < TIER_TOKENS.length; i++) if (tokens >= TIER_TOKENS[i]) t = i + 1;
  return t;
}

/** FNV-1a: the district's stable place in the slot order */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function riverX(z: number): number {
  return 5 * Math.sin(z / 17) + 2 * Math.sin(z / 7);
}

/** the shared frame of a territory grid: spacing from the largest district, columns and rows from the count */
export interface Grid {
  /** centre-to-centre distance in a column; > 2 × the largest radius, so no two districts touch */
  step: number;
  /** distance between columns (staggered rows keep diagonal neighbours a full `step` apart) */
  colStep: number;
  /** x of the column nearest the river */
  x0: number;
  /** rows reach |z| ≤ zLimit */
  zLimit: number;
  /** half-rows above and below the centre line */
  half: number;
  maxRadius: number;
}

export function gridFor(perSide: number, maxRadius: number): Grid {
  const step = Math.max(44, 2 * maxRadius + 4);
  const colStep = (step * 40) / 44; // ≥ step·√3/2, so staggered neighbours stay `step` apart
  // rows per column grow until the territory is no wider than ~1.4 × its height
  let half = 1;
  for (;;) {
    const perPair = 4 * half + 3; // an even column holds 2h+1, an odd one 2h+2
    const cols = Math.ceil((2 * Math.max(1, perSide)) / perPair);
    if (cols * colStep <= 2 * step * (half + 0.5) * 1.4) break;
    half++;
  }
  return { step, colStep, x0: maxRadius + 12, zLimit: step * (half + 0.5), half, maxRadius };
}

/** district centres on a staggered grid inside one territory (side −1 = west/Claude, +1 = east/Codex) */
export function slotsFor(side: -1 | 1, n = 10, g: Grid = gridFor(10, 20)): Vec[] {
  const out: Vec[] = [];
  for (let ci = 0; out.length < n; ci++) {
    const x = g.x0 + ci * g.colStep;
    const off = ci % 2 ? g.step / 2 : 0;
    for (let z = -g.zLimit; z <= g.zLimit + 1e-9; z += g.step / 2) {
      const k = Math.round((z - off) / g.step);
      if (Math.abs(k * g.step + off - z) < 1e-6 && Math.abs(z) <= g.zLimit + 1e-9) out.push({ x: side * x, z: Math.round(z * 100) / 100 });
    }
    if (ci > 400) throw new Error(`slotsFor: could not lay out ${n} districts`);
  }
  // nearest the river first: shared projects take these, so their bridge is short
  return out.sort((a, b) => Math.abs(a.x) - Math.abs(b.x) || Math.abs(a.z) - Math.abs(b.z) || a.z - b.z);
}

/** a town's name: its folder, with the parent folder added when two towns of a faction share it */
function townNames(towns: { faction: Faction; projectId: string }[], home?: string): Map<string, string> {
  const parts = (p: string) => p.split(/[\\/]/).filter(Boolean);
  const base = (p: string) => (home !== undefined && p === home ? tx("worldgen.home") : parts(p).pop() ?? p);
  const count = new Map<string, number>();
  for (const t of towns) count.set(`${t.faction}|${base(t.projectId)}`, (count.get(`${t.faction}|${base(t.projectId)}`) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const t of towns) {
    const b = base(t.projectId);
    const ps = parts(t.projectId);
    out.set(districtKey(t), (count.get(`${t.faction}|${b}`) ?? 0) > 1 && ps.length > 1 ? ps.slice(-2).join("/") : b);
  }
  return out;
}

/** a district's radius from how many houses it shows */
function radiusFor(houses: number): number {
  const rings = houses ? ringOf(houses - 1) + 1 : 1;
  return HOUSE_RING + Math.max(1, rings) * HOUSE_STEP + 1;
}

/**
 * `home`: the user's home directory, named 主目录. `live`: tasks animated in full right now; they are sites, never houses. Without it, a task with
 * tool calls counts as live (the demo's convention).
 */
export function buildWorld(events: AgentTownEvent[], live?: Set<string>, home?: string): World {
  // ---- per-project summaries ------------------------------------------------------------------
  interface Acc { faction: Faction; projectId: string; tokens: number; tasks: Map<string, { start?: number; end?: number; last: number; ok: boolean | null; tokens: number; title?: string; live: boolean }>; detailed: boolean }
  const acc = new Map<string, Acc>();
  for (const e of events) {
    const k = districtKey(e);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { faction: e.faction, projectId: e.projectId, tokens: 0, tasks: new Map(), detailed: false }));
    if (e.kind === "tool_start") a.detailed = true;
    if (!e.taskId) continue;
    let t = a.tasks.get(e.taskId);
    if (!t) a.tasks.set(e.taskId, (t = { ok: null, tokens: 0, live: live ? live.has(e.taskId) : false, last: e.ts }));
    t.last = Math.max(t.last, e.ts);
    // a task with tool calls is animated on the district's site, so it is not also a house
    if (!live && e.kind === "tool_start") t.live = true;
    if (e.kind === "task_start") {
      t.start = e.ts;
      t.title = e.title ?? (e.continues ? tx("worldgen.continues", { title: e.continues }) : undefined);
    } else if (e.kind === "task_end") {
      t.end = e.ts;
      t.ok = e.status !== "error";
    } else if (e.kind === "model_call" && e.tokens) {
      const n = e.tokens.input + e.tokens.output + e.tokens.cacheRead + e.tokens.cacheWrite;
      t.tokens += n;
      a.tokens += n;
    }
  }

  // ---- placement: shared paths first (nearest the river, same row on both banks) --------------
  const keys = [...acc.keys()];
  const shared = new Set([...acc.values()].filter((a) => [...acc.values()].some((b) => b !== a && b.projectId === a.projectId)).map((a) => a.projectId));
  const order = keys.sort((x, y) => {
    const ax = acc.get(x)!;
    const ay = acc.get(y)!;
    const sx = shared.has(ax.projectId) ? 0 : 1;
    const sy = shared.has(ay.projectId) ? 0 : 1;
    return sx - sy || hash(x) - hash(y);
  });
  // houses and radius depend only on the project's own tasks, so they are known before placement
  const plan = new Map<string, { tier: number; done: [string, Acc["tasks"] extends Map<string, infer T> ? T : never][]; shown: number; radius: number }>();
  for (const [k, a] of acc) {
    const tier = tierOf(a.tokens);
    // finished tasks (and tasks that stopped without an end), newest kept as houses
    const done = [...a.tasks.entries()].filter(([, t]) => t.start !== undefined && !t.live).sort((x, y) => (x[1].end ?? x[1].last) - (y[1].end ?? y[1].last));
    const shown = Math.min(done.length, tier * HOUSES_PER_TIER);
    plan.set(k, { tier, done, shown, radius: radiusFor(shown) });
  }
  const perSide = Math.max(1, ...(["claude-code", "codex"] as const).map((f) => [...acc.values()].filter((a) => a.faction === f).length));
  const grid = gridFor(perSide, Math.max(20, ...[...plan.values()].map((p) => p.radius)));
  const slotsBy = { "claude-code": slotsFor(-1, perSide, grid), codex: slotsFor(1, perSide, grid) };
  const names = townNames([...acc.values()], home);
  const taken: Record<Faction, Set<number>> = { "claude-code": new Set(), codex: new Set() };
  const sharedRow = new Map<string, number>();
  const districts: District[] = [];
  for (const k of order) {
    const a = acc.get(k)!;
    const slots = slotsBy[a.faction];
    let idx: number;
    const row = sharedRow.get(a.projectId);
    if (row !== undefined && !taken[a.faction].has(row)) idx = row;
    else if (shared.has(a.projectId)) idx = slots.findIndex((_, i) => !taken[a.faction].has(i));
    else {
      // open addressing from the hash's preferred slot: a project keeps its place as others come
      idx = hash(a.projectId) % slots.length;
      for (let n = 0; taken[a.faction].has(idx) && n < slots.length; n++) idx = (idx + 1) % slots.length;
    }
    if (idx < 0 || taken[a.faction].has(idx)) throw new Error(`no free district slot for ${k} (${slots.length} slots per territory)`);
    taken[a.faction].add(idx);
    if (shared.has(a.projectId)) sharedRow.set(a.projectId, idx);
    const origin = slots[idx];
    const { tier, done, shown: count, radius } = plan.get(k)!;
    const shown = done.slice(done.length - count);
    const houses: House[] = shown.map(([taskId, t], i) => ({
      taskId,
      at: houseSlot(origin, i, a.faction),
      floors: Math.max(1, Math.min(6, Math.round(Math.log2(Math.max(1, t.tokens / 60_000))))),
      ok: t.end === undefined ? null : t.ok ?? true,
      builtAt: t.end ?? t.last,
      tokens: t.tokens,
      title: t.title,
    }));
    districts.push({
      key: k, faction: a.faction, projectId: a.projectId, name: names.get(k)!,
      origin, tier, tokens: a.tokens, radius, houses,
      olderTasks: done.length - shown.length, detailed: a.detailed,
    });
  }

  // ---- bridges (plan "跨阵营协作") --------------------------------------------------------------
  const bridges: Bridge[] = [];
  const byKey = new Map(districts.map((d) => [d.key, d]));
  for (const p of shared) {
    const [ka, kb] = [`claude-code|${p}`, `codex|${p}`];
    const A = acc.get(ka);
    const B = acc.get(kb);
    if (!A || !B) continue;
    const crossings: Crossing[] = [];
    for (const [first, second, k1, k2] of [[A, B, ka, kb], [B, A, kb, ka]] as [Acc, Acc, string, string][]) {
      for (const t2 of second.tasks.values()) {
        if (t2.start === undefined) continue;
        const handOver = [...first.tasks.values()].some((t1) => t1.end !== undefined && t1.end <= t2.start! && t2.start! - t1.end <= BRIDGE_WINDOW_MS);
        if (handOver) crossings.push({ from: k1, to: k2, at: t2.start });
      }
    }
    crossings.sort((x, y) => x.at - y.at);
    if (crossings.length) bridges.push({ districts: [ka, kb], at: crossings[0].at, crossings, a: byKey.get(ka)!.origin, b: byKey.get(kb)!.origin });
  }

  // ---- the frame: coast, capitals and river follow the grid ----------------------------------
  const xs = [...slotsBy["claude-code"], ...slotsBy.codex].map((p) => Math.abs(p.x));
  const reach = grid.zLimit + grid.maxRadius;
  const capZ = reach + 12;
  const capX = grid.x0 + grid.colStep * 0.6;
  const capitals: Record<Faction, Vec> = { "claude-code": { x: -capX, z: capZ }, codex: { x: capX, z: capZ } };
  // a mountain band (minZ + 8 … minZ + 26) clear of the northernmost districts
  const bounds = { minX: -(Math.max(...xs) + grid.maxRadius + 8), maxX: Math.max(...xs) + grid.maxRadius + 8, minZ: -(reach + 30), maxZ: capZ + 18 };
  const roads = districts.map((d) => ({ district: d.key, points: road(capitals[d.faction], d.origin) }));
  const river: Vec[] = [];
  for (let z = bounds.minZ - 5; z <= capZ + 1e-9; z += 5) river.push({ x: riverX(z), z });
  return { districts, capitals, roads, bridges, river, bounds };
}

/** the ring the i-th house lands on */
function ringOf(i: number): number {
  let ring = 0;
  let n = i;
  while (n >= Math.floor(ringCapacity(ring) * (210 / 360))) {
    n -= Math.floor(ringCapacity(ring) * (210 / 360));
    ring++;
  }
  return ring;
}

/** houses that fit on ring `r` */
function ringCapacity(r: number): number {
  return Math.floor((2 * Math.PI * (HOUSE_RING + r * HOUSE_STEP)) / 2.6);
}

/**
 * The i-th house slot: rings outward from HOUSE_RING over the back 210° of the district. The front
 * (−10°…140°, toward the camera) is left open: the hall, sentry booth and warehouse stand there and
 * houses must never stand in front of the work.
 */
export function houseSlot(origin: Vec, i: number, faction: Faction): Vec {
  let ring = 0;
  let n = i;
  for (;;) {
    const usable = Math.floor(ringCapacity(ring) * (210 / 360));
    if (n < usable) {
      const r = HOUSE_RING + ring * HOUSE_STEP;
      const start = (140 * Math.PI) / 180;
      const span = (210 * Math.PI) / 180;
      const a = start + (span * (n + 0.5)) / usable + (faction === "codex" ? 0.02 : 0);
      return { x: origin.x + Math.cos(a) * r, z: origin.z + Math.sin(a) * r };
    }
    n -= usable;
    ring++;
  }
}

function road(a: Vec, b: Vec): Vec[] {
  // a gentle dog-leg: out of the capital along z, then across
  const mid = { x: b.x, z: a.z - 10 };
  return [a, { x: a.x, z: a.z - 10 }, mid, b];
}
