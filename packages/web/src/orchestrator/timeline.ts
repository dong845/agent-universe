// Animation orchestrator (plan "动画编排器"): events are instants, animation takes time. This turns an
// event list into per-figure actions plus site states, as a pure function of the events, so replay,
// scrubbing and tests all read the same timeline. All times are ms after the first event.
import type { AgentTownEvent, Role } from "../../../schema/src/event.ts";
import { detectRework } from "../../../schema/src/insights.ts";
import { buildingOf, type BuildingId } from "../../../schema/src/world.ts";
import {
  BUILDING_POS, COMMANDER_POST, HALL, MAX_SCAFFOLDS, SENTRY_POST, WAREHOUSE, dist, doorOf, lerp, scaffoldPos, type Vec,
} from "./layout.ts";

/** plan: a walk lasts at most 1.5 s */
export const MAX_WALK_MS = 1500;
/** plan: the picture is never more than 3 s behind the event it shows */
export const MAX_LAG_MS = 3000;
/** world units per second */
export const WALK_SPEED = 9;
export const THINK_MS = 700;
export const MIN_WORK_MS = 300;
/** plan: at most 12 cubes per flight */
export const MAX_CUBES = 12;

export type Pose = "idle" | "walk" | "carry" | "work" | "think" | "dispatch" | "raise_hand" | "shake" | "fall" | "pack" | "report";

export interface Action {
  start: number;
  end: number;
  /** when the thing this action shows happened; start − due never exceeds MAX_LAG_MS */
  due: number;
  from: Vec;
  to: Vec;
  pose: Pose;
  outfit: Role;
  eventId: string;
  building?: BuildingId;
}

export interface Actor {
  id: string; // agentId
  kind: "commander" | "subagent";
  baseRole: Role;
  agentType?: string;
  agentTask?: string;
  home: Vec;
  /** working position beside a building door, so figures working side by side do not overlap */
  lane: number;
  slot?: number;
  appear: number;
  vanish: number | null;
  actions: Action[];
  /** context fill (0..1) as of each model call or compaction */
  backpack: { t: number; ratio: number }[];
}

export type CubeKind = "input" | "output" | "cache";

export interface Flight {
  start: number;
  end: number;
  from: Vec;
  to: Vec;
  kind: CubeKind;
  count: number;
  tokens: number;
  eventId: string;
}

export interface Floor {
  t: number;
  kind: "main" | "subagent";
  agentId: string;
  eventId: string;
}

export interface Scaffold {
  agentId: string;
  slot: number;
  pos: Vec;
  appear: number;
  /** when it merged into the site as a floor */
  merge: number | null;
  floors: number[];
}

export interface Span {
  start: number;
  end: number | null;
  eventId: string;
  file?: string;
}

export interface Timeline {
  t0: number;
  duration: number;
  actors: Actor[];
  flights: Flight[];
  floors: Floor[];
  scaffolds: Scaffold[];
  foundationAt: number | null;
  roofAt: number | null;
  smoke: Span[];
  clouds: Span[];
  buildingSmoke: { building: BuildingId; start: number; end: number; eventId: string }[];
  hallLit: { start: number; end: number }[];
  bubbles: { agentId: string; start: number; end: number; size: number }[];
  /** event times on the playback axis, for the timeline bar */
  markers: { t: number; kind: AgentTownEvent["kind"]; status?: string }[];
  /** figures cut short to stay within MAX_LAG_MS */
  fastForwards: number;
}

export function cubesFor(tokens: number): number {
  if (tokens <= 0) return 0;
  return Math.max(1, Math.min(MAX_CUBES, Math.floor(Math.log10(tokens))));
}

interface State {
  actor: Actor;
  pos: Vec;
  free: number;
}

export function buildTimeline(input: AgentTownEvent[]): Timeline {
  const events = [...input].sort((a, b) => a.ts - b.ts || order(a) - order(b));
  const t0 = events.length ? events[0].ts : 0;
  const rel = (e: AgentTownEvent) => e.ts - t0;
  const tl: Timeline = {
    t0, duration: events.length ? rel(events[events.length - 1]) : 0, actors: [], flights: [], floors: [], scaffolds: [],
    foundationAt: null, roofAt: null, smoke: [], clouds: [], buildingSmoke: [], hallLit: [], bubbles: [], markers: [], fastForwards: 0,
  };

  const ends = new Map<string, AgentTownEvent>();
  const starts = new Map<string, AgentTownEvent>();
  for (const e of events) {
    if (e.kind === "tool_end" && e.toolUseId) ends.set(e.toolUseId, e);
    if (e.kind === "tool_start" && e.toolUseId) starts.set(e.toolUseId, e);
  }
  const states = new Map<string, State>();
  const handled = new Set<string>(); // awaiting_user events consumed by the tool they belong to

  const ensureCommander = (e: AgentTownEvent): State => {
    let s = states.get(e.agentId);
    if (!s) {
      const actor: Actor = { id: e.agentId, kind: "commander", baseRole: "commander", home: COMMANDER_POST, lane: 0, appear: rel(e), vanish: null, actions: [], backpack: [] };
      tl.actors.push(actor);
      s = { actor, pos: HALL, free: rel(e) };
      states.set(e.agentId, s);
    }
    return s;
  };
  const stateOf = (e: AgentTownEvent): State => states.get(e.agentId) ?? ensureCommander(e);

  /** drop or shorten everything this figure would still be doing at `at` (plan: 自动快进) */
  const cut = (s: State, at: number) => {
    const acts = s.actor.actions;
    while (acts.length && acts[acts.length - 1].start >= at) acts.pop();
    const last = acts[acts.length - 1];
    if (last && last.end > at) {
      const f = (at - last.start) / (last.end - last.start);
      last.to = lerp(last.from, last.to, f);
      last.end = at;
    }
    s.pos = last ? last.to : s.actor.home;
    s.free = at;
    tl.fastForwards++;
  };
  /** when an action for event time `et` may start; behind the log, everything runs at double speed */
  const begin = (s: State, et: number): { start: number; scale: number } => {
    const start = Math.min(Math.max(et, s.free), et + MAX_LAG_MS);
    return { start, scale: start > et ? 0.5 : 1 };
  };
  /** every action goes through here, so no action ever starts more than MAX_LAG_MS after its due time */
  const push = (s: State, a: Omit<Action, "from" | "to"> & { to?: Vec }): number => {
    let { start, end } = a;
    if (end <= start) return start;
    if (start < s.free) start = s.free;
    if (start - a.due > MAX_LAG_MS) start = a.due + MAX_LAG_MS;
    if (start < s.free) cut(s, start);
    end = start + (a.end - a.start);
    const to = a.to ?? s.pos;
    s.actor.actions.push({ ...a, start, end, from: s.pos, to });
    s.pos = to;
    s.free = end;
    return end;
  };
  const walk = (s: State, to: Vec, start: number, scale: number, pose: Pose, outfit: Role, eventId: string, due: number, building?: BuildingId) => {
    const d = dist(s.pos, to);
    if (d < 0.01) return start;
    const dur = Math.max(150, Math.min(MAX_WALK_MS, (d / WALK_SPEED) * 1000)) * scale;
    return push(s, { start, end: start + dur, to, pose, outfit, eventId, due, building });
  };
  const stay = (s: State, start: number, end: number, pose: Pose, outfit: Role, eventId: string, due: number, building?: BuildingId) =>
    push(s, { start, end, pose, outfit, eventId, due, building });
  const homeOf = (s: State) => s.actor.home;
  const nextModelInput = (agentId: string, after: number): number => {
    for (const e of events) {
      if (e.ts <= after || e.agentId !== agentId) continue;
      if (e.kind === "model_call" && e.tokens) return e.tokens.input + e.tokens.cacheWrite;
      if (e.kind === "tool_start") return 0; // another tool ran first: nothing to attribute
    }
    return 0;
  };
  let nextSlot = 0;

  for (const e of events) {
    const et = rel(e);
    tl.markers.push({ t: et, kind: e.kind, status: e.status });

    if (e.kind === "task_start") {
      const s = ensureCommander(e);
      tl.foundationAt ??= et;
      tl.hallLit.push({ start: et, end: et + 2500 });
      const { start, scale } = begin(s, et);
      const at = dist(s.pos, HALL) > 0.01 ? walk(s, HALL, start, scale, "walk", "commander", e.id, et) : start;
      walk(s, COMMANDER_POST, at, scale, "carry", "commander", e.id, et); // blueprint to the new site
      continue;
    }
    if (e.kind === "task_end") {
      tl.roofAt = et;
      continue;
    }
    if (e.kind === "agent_spawn" && e.agentType === "guardian") {
      // a guardian reviews approvals from the sentry post: no scaffold, and it builds no floor
      const actor: Actor = { id: e.agentId, kind: "subagent", baseRole: "sentry", agentType: "guardian", home: SENTRY_POST, lane: 0, appear: et, vanish: null, actions: [], backpack: [] };
      tl.actors.push(actor);
      states.set(e.agentId, { actor, pos: SENTRY_POST, free: et });
      continue;
    }
    if (e.kind === "agent_spawn") {
      const slot = nextSlot++;
      const pos = scaffoldPos(slot % MAX_SCAFFOLDS);
      const actor: Actor = {
        id: e.agentId, kind: "subagent", baseRole: e.role ?? "commander", agentType: e.agentType, agentTask: e.agentTask,
        home: pos, lane: (slot % 4) + 1, slot, appear: et, vanish: null, actions: [], backpack: [],
      };
      tl.actors.push(actor);
      states.set(e.agentId, { actor, pos, free: et });
      tl.scaffolds.push({ agentId: e.agentId, slot, pos, appear: et, merge: null, floors: [] });
      continue;
    }

    const s = stateOf(e);
    const role = s.actor.baseRole;

    if (e.kind === "model_call") {
      const { start, scale } = begin(s, et);
      const end = stay(s, start, start + THINK_MS * scale, "think", role, e.id, et);
      const t = e.tokens!;
      const ratio = e.contextUsed !== undefined && e.contextMax ? e.contextUsed / e.contextMax : undefined;
      if (ratio !== undefined) s.actor.backpack.push({ t: et, ratio });
      if (t.reasoning) tl.bubbles.push({ agentId: e.agentId, start, end, size: cubesFor(t.reasoning) });
      const where = s.pos;
      if (t.output) tl.flights.push({ start, end: end + 400, from: where, to: homeOf(s), kind: "output", count: cubesFor(t.output), tokens: t.output, eventId: e.id });
      if (t.cacheRead) tl.flights.push({ start, end, from: WAREHOUSE, to: where, kind: "cache", count: cubesFor(t.cacheRead), tokens: t.cacheRead, eventId: e.id });
      continue;
    }

    if (e.kind === "tool_start") {
      const end = e.toolUseId ? ends.get(e.toolUseId) : undefined;
      const te = end ? rel(end) : et + 800;
      const endId = end?.id ?? e.id;
      const b = buildingOf(e.role);
      let { start, scale } = begin(s, et);
      if (!b) {
        // dispatch (Agent, Workflow, spawn_agent…) or a commander-only tool: done at the site
        stay(s, start, start + 600 * scale, "dispatch", "commander", e.id, et);
        continue;
      }
      const outfit = e.role!;
      // a permission prompt inside this call: wait at the hall first (plan: 等待授权 → 任务大厅举手)
      const wait = events.find((w) => w.kind === "awaiting_user" && w.agentId === e.agentId && w.ts >= e.ts && (!end || w.ts <= end.ts));
      let goDue = et;
      if (wait) {
        handled.add(wait.id);
        start = walk(s, HALL, start, scale, "walk", outfit, e.id, et);
        // the approval itself is not in the log; it is placed just before the result arrives
        goDue = Math.max(rel(wait), te - 900);
        start = stay(s, start, Math.max(start + 400, goDue), "raise_hand", outfit, wait.id, rel(wait));
      }
      const arrive = walk(s, doorOf(b, s.actor.lane), start, scale, "walk", outfit, e.id, goDue, b);
      const workDone = stay(s, arrive, Math.max(arrive + MIN_WORK_MS * scale, Math.min(te, arrive + MAX_LAG_MS)), "work", outfit, e.id, goDue, b);
      const status = end?.status ?? "ok";
      let backAt = workDone;
      if (status === "error") {
        tl.buildingSmoke.push({ building: b, start: workDone, end: workDone + 2500, eventId: endId });
        backAt = stay(s, workDone, workDone + 800 * scale, "fall", outfit, endId, te, b);
      } else if (status === "denied") {
        backAt = stay(s, workDone, workDone + 700 * scale, "shake", outfit, endId, te, b);
      }
      const home = homeOf(s);
      const arriveHome = walk(s, home, backAt, scale, status === "ok" ? "carry" : "walk", outfit, endId, te);
      if (status === "ok") {
        const tokens = nextModelInput(e.agentId, end ? end.ts : e.ts);
        if (tokens > 0) tl.flights.push({ start: backAt, end: Math.max(arriveHome, backAt + 300), from: BUILDING_POS[b], to: home, kind: "input", count: cubesFor(tokens), tokens, eventId: endId });
        if (e.role === "smith") {
          if (s.actor.kind === "commander") tl.floors.push({ t: te, kind: "main", agentId: e.agentId, eventId: endId });
          else tl.scaffolds.find((x) => x.agentId === e.agentId)?.floors.push(te);
        }
      }
      continue;
    }

    if (e.kind === "awaiting_user") {
      if (handled.has(e.id)) continue;
      const next = events.find((n) => n.ts > e.ts && n.agentId === e.agentId);
      const { start, scale } = begin(s, et);
      const at = walk(s, s.actor.agentType === "guardian" ? SENTRY_POST : HALL, start, scale, "walk", role, e.id, et);
      stay(s, at, Math.max(at + 400, next ? rel(next) : at + 2000), "raise_hand", role, e.id, et);
      continue;
    }

    if (e.kind === "agent_return" && s.actor.agentType === "guardian") {
      const { start } = begin(s, et);
      s.actor.vanish = Math.max(start, s.free) + 300;
      continue;
    }
    if (e.kind === "agent_return") {
      const parent = states.get("main");
      const { start, scale } = begin(s, et);
      const to = parent ? parent.pos : COMMANDER_POST;
      const arrive = walk(s, { x: to.x + 0.9, z: to.z + 0.9 }, start, scale, "report", role, e.id, et);
      s.actor.vanish = arrive + 300;
      const sc = tl.scaffolds.find((x) => x.agentId === e.agentId);
      if (sc) sc.merge = arrive;
      tl.floors.push({ t: arrive, kind: "subagent", agentId: e.agentId, eventId: e.id });
      continue;
    }

    if (e.kind === "compaction") {
      const { start, scale } = begin(s, et);
      stay(s, start, start + 900 * scale, "pack", role, e.id, et);
      // after compaction the backpack holds postTokens against the limit the model calls reported
      const limit = lastContextMax(events, e);
      const post = e.compaction?.postTokens;
      s.actor.backpack.push({ t: et, ratio: limit && post !== undefined ? post / limit : 0 });
      continue;
    }

    if (e.kind === "error") {
      const { start, scale } = begin(s, et);
      stay(s, start, start + 800 * scale, "fall", role, e.id, et);
      continue;
    }
    // tool_end is consumed by its tool_start; nothing else moves a figure
  }

  const rw = detectRework(events);
  tl.smoke = rw.smoke.map((i) => ({ start: i.start - t0, end: i.end === null ? null : i.end - t0, eventId: i.eventId }));
  tl.clouds = rw.clouds.map((i) => ({ start: i.start - t0, end: i.end === null ? null : i.end - t0, eventId: i.eventId, file: i.file }));
  for (const a of tl.actors) a.actions.sort((x, y) => x.start - y.start);
  tl.duration = Math.max(tl.duration, ...tl.actors.map((a) => a.actions.at(-1)?.end ?? 0));
  return tl;
}

/** same-timestamp ordering: starts before the work they begin, ends after */
function order(e: AgentTownEvent): number {
  switch (e.kind) {
    case "task_start": return 0;
    case "agent_spawn": return 1;
    case "agent_return": return 3;
    case "task_end": return 4;
    default: return 2;
  }
}

function lastContextMax(events: AgentTownEvent[], at: AgentTownEvent): number | undefined {
  let max: number | undefined;
  for (const e of events) {
    if (e.ts > at.ts) break;
    if (e.agentId === at.agentId && e.sessionId === at.sessionId && e.contextMax) max = e.contextMax;
  }
  return max;
}

export interface ActorSample {
  visible: boolean;
  pos: Vec;
  pose: Pose;
  outfit: Role;
  /** the event the figure is showing right now */
  eventId?: string;
  building?: BuildingId;
  backpack: number;
}

/** Where a figure is and what it does at playback time t (ms after the first event). */
export function sampleActor(a: Actor, t: number): ActorSample {
  const visible = t >= a.appear && (a.vanish === null || t < a.vanish);
  const backpack = valueAt(a.backpack, t);
  const acts = a.actions;
  // last action that has started
  let lo = 0;
  let hi = acts.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (acts[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) {
    const first = acts[0];
    return { visible, pos: first ? first.from : a.home, pose: "idle", outfit: a.baseRole, backpack };
  }
  const cur = acts[idx];
  if (t < cur.end) {
    const f = (t - cur.start) / (cur.end - cur.start);
    return { visible, pos: lerp(cur.from, cur.to, f), pose: cur.pose, outfit: cur.outfit, eventId: cur.eventId, building: cur.building, backpack };
  }
  return { visible, pos: cur.to, pose: "idle", outfit: a.kind === "commander" ? "commander" : a.baseRole, backpack };
}

function valueAt(series: { t: number; ratio: number }[], t: number): number {
  let v = 0;
  for (const p of series) {
    if (p.t > t) break;
    v = p.ratio;
  }
  return v;
}

/** Number of floors on the site at time t, split by who built them. */
export function floorsAt(tl: Timeline, t: number): Floor[] {
  return tl.floors.filter((f) => f.t <= t);
}

export function activeAt(spans: Span[], t: number): Span | undefined {
  return spans.find((s) => s.start <= t && (s.end === null || t < s.end));
}

