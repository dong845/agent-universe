// A finished request played again in its city (owner 2026-11-01: click a house to replay it). Its own
// clock, independent of the world's time bar.
import { create } from "zustand";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import type { Places } from "../orchestrator/layout.ts";
import { buildTimeline, type Timeline } from "../orchestrator/timeline.ts";

export const REPLAY_SPEEDS = [1, 2, 4, 16] as const;
/** in a replay, a quiet stretch longer than this is shortened to it (the model or the user was idle) */
export const MAX_GAP_MS = 5000;

/**
 * The same events with every quiet gap longer than `maxGap` shortened to `maxGap`; order and the
 * events themselves are unchanged. Returns how much time was cut, for the replay bar.
 */
export function compressGaps(events: AgentTownEvent[], maxGap = MAX_GAP_MS): { events: AgentTownEvent[]; cut: number } {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  let cut = 0;
  const out = sorted.map((e, i) => {
    if (i > 0) {
      const gap = e.ts - sorted[i - 1].ts;
      if (gap > maxGap) cut += gap - maxGap;
    }
    return cut ? { ...e, ts: e.ts - cut } : e;
  });
  return { events: out, cut };
}

export interface CityReplay {
  district: string;
  requestId: string;
  title: string;
  tl: Timeline;
  /** the request's events on the replay's own clock (idle gaps cut): the follow card reads them */
  events: AgentTownEvent[];
  /** ms after the request's first event */
  t: number;
  speed: number;
  playing: boolean;
  /** quiet time left out of the replay, ms */
  cut: number;
  /** the camera follows the main agent */
  follow: boolean;
}

interface ReplayStore {
  r: CityReplay | null;
  start(district: string, requestId: string, title: string, events: AgentTownEvent[], places: Places): void;
  stop(): void;
  toggle(): void;
  setFollow(f: boolean): void;
  setSpeed(s: number): void;
  seek(t: number): void;
  /** jump to the next thing any agent starts doing */
  next(): void;
  tick(dtMs: number): void;
}

export const useReplay = create<ReplayStore>((set, get) => ({
  r: null,
  start(district, requestId, title, events, places) {
    if (!events.length) throw new Error(`request ${requestId} has no events to replay`);
    const c = compressGaps(events);
    set({ r: { district, requestId, title, tl: buildTimeline(c.events, places), events: c.events, t: 0, speed: 2, playing: true, cut: c.cut, follow: true } });
  },
  stop: () => set({ r: null }),
  setFollow(f) {
    const r = get().r;
    if (r) set({ r: { ...r, follow: f } });
  },
  toggle() {
    const r = get().r;
    if (!r) return;
    // at the end, play starts over
    set({ r: { ...r, playing: !r.playing, t: !r.playing && r.t >= r.tl.duration + 1500 ? 0 : r.t } });
  },
  setSpeed(s) {
    const r = get().r;
    if (r) set({ r: { ...r, speed: s } });
  },
  seek(t) {
    const r = get().r;
    if (r) set({ r: { ...r, t: Math.max(0, Math.min(t, r.tl.duration + 1500)) } });
  },
  next() {
    const r = get().r;
    if (!r) return;
    let at = Infinity;
    for (const a of r.tl.actors) for (const x of a.actions) if (x.start > r.t + 50 && x.start < at) at = x.start;
    if (at < Infinity) set({ r: { ...r, t: at - 10 } });
  },
  tick(dtMs) {
    const r = get().r;
    if (!r || !r.playing) return;
    const end = r.tl.duration + 1500;
    const t = Math.min(end, r.t + dtMs * r.speed);
    set({ r: { ...r, t, playing: t < end } });
  },
}));

/** a planet clicked in space: the page flies there, then opens its city */
export const useEnter = create<{ entering: string | null; request(k: string): void; clear(): void }>((set) => ({
  entering: null,
  request: (k) => set({ entering: k }),
  clear: () => set({ entering: null }),
}));

/** the towns that have a city to enter (the planets drawn in space) */
export const cityTowns = new Set<string>();
