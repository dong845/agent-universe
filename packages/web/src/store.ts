import { create } from "zustand";
import { buildLedger, type Ledger } from "../../schema/src/aggregate.ts";
import type { AgentTownEvent, Faction } from "../../schema/src/event.ts";
import type { WorldPayload } from "../../schema/src/payload.ts";
import type { BuildingId } from "../../schema/src/world.ts";
import { buildTimeline, type Timeline } from "./orchestrator/timeline.ts";
import { buildWorld, districtKey, type District, type World } from "./orchestrator/worldgen.ts";
import type { Selection } from "./selection.ts";
import type { LookId } from "./world/looks.ts";

export type HoverTarget =
  | { kind: "figure"; district: string; agentId: string }
  | { kind: "site"; district: string }
  | { kind: "scaffold"; district: string; agentId: string }
  | { kind: "building"; district: string; id: BuildingId }
  | { kind: "house"; district: string; taskId: string }
  | { kind: "district"; district: string }
  | { kind: "faction"; faction: Faction };

export const SPEEDS = [1, 2, 4, 8, 16, 64] as const;
/** plan: hover-card numbers refresh at most 4 times a second */
export const UI_REFRESH_MS = 250;

/** a district plus, when it has live detailed events, its animation timeline */
export interface Runtime {
  district: District;
  timeline: Timeline | null;
  /** the timeline's first event, in ms after the world clock's zero */
  offset: number;
}

interface Store {
  events: AgentTownEvent[];
  source: WorldPayload["source"];
  /** tasks that stopped without a recorded end and are not live: never counted as in progress */
  unended: Set<string>;
  world: World;
  runtimes: Runtime[];
  /** the first runtime with a timeline; the default focus */
  primary: Runtime | null;
  ledger: Ledger;
  /** absolute time of playback zero: the first live (detailed) event */
  t0: number;
  duration: number;
  /** playback clock, ms after t0; advanced every frame */
  t: number;
  /** the same clock, refreshed at most every UI_REFRESH_MS for DOM panels */
  uiT: number;
  playing: boolean;
  speed: number;
  hovered: HoverTarget | null;
  pointer: { x: number; y: number };
  look: LookId;
  /** district key the camera flies to; null = the whole world */
  focus: string | null;
  /** what was clicked: the camera pushes in to it and the diary shows it */
  selected: Selection | null;
  /** tasks animated in full (the payload's live tasks) */
  live: Set<string>;
  /** a task being rebuilt on its town's site (spec 4 "重放") */
  replay: { district: string; taskId: string } | null;
  startReplay(district: string, events: AgentTownEvent[]): void;
  stopReplay(): void;
  select(s: Selection | null): void;
  /** one level out: selection → its town → the whole world */
  back(): void;
  /** towns drawn in full detail (the rest are far massing) */
  detail: Set<string>;
  setDetail(k: Set<string>): void;
  /** camera close enough for detail (labels, figures, ambient occlusion) */
  near: boolean;
  setNear(n: boolean): void;
  setLook(l: LookId): void;
  setFocus(k: string | null): void;
  load(p: WorldPayload): void;
  setTime(t: number): void;
  advance(dtMs: number): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  setHovered(h: HoverTarget | null): void;
  setPointer(x: number, y: number): void;
}

let lastUi = 0;
/** the runtime and clock length a replay replaced */
let saved: { runtime: Runtime; duration: number } | null = null;

/**
 * Split events into districts. A district's timeline animates only its live tasks — tasks with tool
 * calls; summarised history (start, one call, end) is drawn as houses, not replayed.
 */
function runtimesOf(events: AgentTownEvent[], world: World, liveTasks: Set<string>): { runtimes: Runtime[]; t0: number; duration: number } {
  const live = events.filter((e) => e.taskId && liveTasks.has(e.taskId));
  const t0 = live.length ? Math.min(...live.map((e) => e.ts)) : events.length ? events[events.length - 1].ts : 0;
  let duration = 0;
  const runtimes = world.districts.map((d) => {
    const mine = live.filter((e) => districtKey(e) === d.key);
    if (!mine.length) return { district: d, timeline: null, offset: 0 };
    const timeline = buildTimeline(mine);
    const offset = timeline.t0 - t0;
    duration = Math.max(duration, offset + timeline.duration);
    return { district: d, timeline, offset };
  });
  return { runtimes, t0, duration };
}

export const useStore = create<Store>((set, get) => ({
  events: [],
  source: "demo",
  unended: new Set(),
  world: buildWorld([]),
  runtimes: [],
  primary: null,
  ledger: buildLedger([]),
  t0: 0,
  duration: 0,
  t: 0,
  uiT: 0,
  playing: true,
  speed: 1,
  hovered: null,
  pointer: { x: 0, y: 0 },
  look: "toy",
  focus: null,
  selected: null,
  live: new Set(),
  replay: null,
  select(s) {
    const r = get().replay;
    if (r && !(s?.kind === "task" && s.taskId === r.taskId) && !(s?.kind === "site" && s.district === r.district)) get().stopReplay();
    set(s ? { selected: s, focus: s.district } : { selected: null });
  },
  back() {
    const { selected, focus } = get();
    if (selected) get().select(null);
    else if (focus) set({ focus: null });
  },
  startReplay(district, events) {
    get().stopReplay();
    const { runtimes, t, duration, primary } = get();
    const i = runtimes.findIndex((r) => r.district.key === district);
    const taskId = events.find((e) => e.taskId)?.taskId;
    if (i < 0 || !taskId) throw new Error(`cannot replay ${taskId ?? "?"} in ${district}`);
    // the town's site rebuilds the task from now on; the original runtime comes back on stop
    const timeline = buildTimeline(events);
    const rt: Runtime = { district: runtimes[i].district, timeline, offset: t };
    saved = { runtime: runtimes[i], duration };
    const next = runtimes.map((r, k) => (k === i ? rt : r));
    set({ runtimes: next, primary: primary?.district.key === district ? rt : primary, duration: Math.max(duration, t + timeline.duration), replay: { district, taskId }, playing: true });
  },
  stopReplay() {
    const { replay, runtimes, primary, t } = get();
    if (!replay || !saved) return;
    const back = saved;
    saved = null;
    const next = runtimes.map((r) => (r.district.key === replay.district ? back.runtime : r));
    set({ runtimes: next, primary: primary?.district.key === replay.district ? back.runtime : primary, duration: back.duration, t: Math.min(t, back.duration), uiT: Math.min(t, back.duration), replay: null });
  },
  detail: new Set(),
  setDetail(k) {
    set({ detail: k });
  },
  near: false,
  setNear(n) {
    if (n !== get().near) set({ near: n });
  },
  setLook(l) {
    set({ look: l });
  },
  setFocus(k) {
    set({ focus: k });
  },
  load(p) {
    const { events, source } = p;
    const live = new Set(p.liveTaskIds);
    const world = buildWorld(events, source === "real" ? live : undefined, p.home);
    let { runtimes, t0, duration } = runtimesOf(events, world, live);
    const ended = new Set(events.filter((e) => e.kind === "task_end" && e.taskId).map((e) => e.taskId!));
    const unended = new Set(events.filter((e) => e.kind === "task_start" && e.taskId && !ended.has(e.taskId) && !live.has(e.taskId)).map((e) => e.taskId!));
    let t = 0;
    if (source === "real" && events.length) {
      // real data: the clock spans the whole record and opens at its end, "now" (spec 12.2)
      const first = events[0].ts;
      const last = events[events.length - 1].ts;
      runtimes = runtimes.map((r) => (r.timeline ? { ...r, offset: r.timeline.t0 - first } : r));
      duration = Math.max(last - first, ...runtimes.map((r) => (r.timeline ? r.offset + r.timeline.duration : 0)));
      t0 = first;
      t = duration;
    }
    const primary = runtimes.find((r) => r.timeline && r.district.faction === "claude-code") ?? runtimes.find((r) => r.timeline) ?? null;
    saved = null;
    set({ events, source, unended, live, replay: null, selected: null, world, runtimes, primary, t0, duration, ledger: buildLedger(events, p.buildingRows), t, uiT: t, playing: source === "real" ? false : get().playing });
  },
  setTime(t) {
    const c = Math.max(0, Math.min(get().duration, t));
    lastUi = performance.now();
    set({ t: c, uiT: c });
  },
  advance(dtMs) {
    const { playing, speed, t, duration } = get();
    if (!playing) return;
    const next = Math.min(duration, t + dtMs * speed);
    const now = performance.now();
    const ui = now - lastUi >= UI_REFRESH_MS || next >= duration;
    if (ui) lastUi = now;
    set(ui ? { t: next, uiT: next, playing: next < duration } : { t: next });
  },
  setPlaying(p) {
    const { t, duration } = get();
    // pressing play at the end starts the replay over
    set({ playing: p, ...(p && t >= duration ? { t: 0, uiT: 0 } : {}) });
  },
  setSpeed(s) {
    set({ speed: s });
  },
  setHovered(h) {
    set({ hovered: h });
  },
  setPointer(x, y) {
    set({ pointer: { x, y } });
  },
}));

/** absolute timestamp of the playback clock, for ledger lookups */
export function absTime(t: number): number {
  return useStore.getState().t0 + t;
}

export function runtimeOf(key: string): Runtime | undefined {
  return useStore.getState().runtimes.find((r) => r.district.key === key);
}
