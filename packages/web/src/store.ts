import { create } from "zustand";
import { buildLedger, type Ledger } from "../../schema/src/aggregate.ts";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import type { BuildingId } from "../../schema/src/world.ts";
import { buildTimeline, type Timeline } from "./orchestrator/timeline.ts";

export type HoverTarget =
  | { kind: "figure"; agentId: string }
  | { kind: "site" }
  | { kind: "scaffold"; agentId: string }
  | { kind: "building"; id: BuildingId }
  | { kind: "district" }
  | { kind: "faction" };

export const SPEEDS = [1, 2, 4, 8, 16, 64] as const;
/** plan: hover-card numbers refresh at most 4 times a second */
export const UI_REFRESH_MS = 250;

interface Store {
  events: AgentTownEvent[];
  timeline: Timeline;
  ledger: Ledger;
  /** playback clock, ms after the first event; advanced every frame */
  t: number;
  /** the same clock, refreshed at most every UI_REFRESH_MS for DOM panels */
  uiT: number;
  playing: boolean;
  speed: number;
  hovered: HoverTarget | null;
  pointer: { x: number; y: number };
  load(events: AgentTownEvent[]): void;
  setTime(t: number): void;
  advance(dtMs: number): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  setHovered(h: HoverTarget | null): void;
  setPointer(x: number, y: number): void;
}

let lastUi = 0;

export const useStore = create<Store>((set, get) => ({
  events: [],
  timeline: buildTimeline([]),
  ledger: buildLedger([]),
  t: 0,
  uiT: 0,
  playing: true,
  speed: 1,
  hovered: null,
  pointer: { x: 0, y: 0 },
  load(events) {
    set({ events, timeline: buildTimeline(events), ledger: buildLedger(events), t: 0, uiT: 0 });
  },
  setTime(t) {
    const d = get().timeline.duration;
    const c = Math.max(0, Math.min(d, t));
    lastUi = performance.now();
    set({ t: c, uiT: c });
  },
  advance(dtMs) {
    const { playing, speed, t, timeline } = get();
    if (!playing) return;
    const next = Math.min(timeline.duration, t + dtMs * speed);
    const now = performance.now();
    const ui = now - lastUi >= UI_REFRESH_MS || next >= timeline.duration;
    if (ui) lastUi = now;
    set(ui ? { t: next, uiT: next, playing: next < timeline.duration } : { t: next });
  },
  setPlaying(p) {
    const { t, timeline } = get();
    // pressing play at the end starts the replay over
    set({ playing: p, ...(p && t >= timeline.duration ? { t: 0, uiT: 0 } : {}) });
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
  return useStore.getState().timeline.t0 + t;
}
