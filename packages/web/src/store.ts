import { create } from "zustand";
import { buildLedger, type Ledger } from "../../schema/src/aggregate.ts";
import type { AgentTownEvent, Faction } from "../../schema/src/event.ts";
import type { BuildingId } from "../../schema/src/world.ts";
import { buildTimeline, type Timeline } from "./orchestrator/timeline.ts";
import { buildWorld, districtKey, type District, type World } from "./orchestrator/worldgen.ts";
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
  /** towns drawn in full detail (the rest are far massing) */
  detail: Set<string>;
  setDetail(k: Set<string>): void;
  /** camera close enough for detail (labels, figures, ambient occlusion) */
  near: boolean;
  setNear(n: boolean): void;
  setLook(l: LookId): void;
  setFocus(k: string | null): void;
  load(events: AgentTownEvent[]): void;
  setTime(t: number): void;
  advance(dtMs: number): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  setHovered(h: HoverTarget | null): void;
  setPointer(x: number, y: number): void;
}

let lastUi = 0;

/**
 * Split events into districts. A district's timeline animates only its live tasks — tasks with tool
 * calls; summarised history (start, one call, end) is drawn as houses, not replayed.
 */
function runtimesOf(events: AgentTownEvent[], world: World): { runtimes: Runtime[]; t0: number; duration: number } {
  const liveTasks = new Set(events.filter((e) => e.kind === "tool_start" && e.taskId).map((e) => e.taskId!));
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
  load(events) {
    const world = buildWorld(events);
    const { runtimes, t0, duration } = runtimesOf(events, world);
    const primary = runtimes.find((r) => r.timeline && r.district.faction === "claude-code") ?? runtimes.find((r) => r.timeline) ?? null;
    set({ events, world, runtimes, primary, t0, duration, ledger: buildLedger(events), t: 0, uiT: 0 });
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
