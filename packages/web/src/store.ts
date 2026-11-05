import { create } from "zustand";
import { buildLedger, type Ledger } from "../../schema/src/aggregate.ts";
import type { AgentTownEvent, Faction } from "../../schema/src/event.ts";
import type { WorldPayload } from "../../schema/src/payload.ts";
import type { BuildingId } from "../../schema/src/world.ts";
import { buildTimeline, type Timeline } from "./orchestrator/timeline.ts";
import { buildWorld, districtKey, type District, type World } from "./orchestrator/worldgen.ts";
import type { Selection } from "./selection.ts";
import type { Attention } from "../../schema/src/attention.ts";
import { maskWorld } from "./share/display.ts";
import type { OfficialMarks } from "./galaxy/emblem.ts";
import { dismissKey, loadClosed, saveClosed } from "./ui/dismiss.ts";
import manifest from "../../../art/manifest.json" with { type: "json" };
import type { Manifest } from "./v3/art.ts";
import type { Spot } from "./v3/townLayout.ts";
import { buildWorld25, type World25 } from "./v3/world25Data.ts";
import { localizePayload } from "./i18n/data.ts";

export type HoverTarget =
  | { kind: "figure"; district: string; agentId: string }
  | { kind: "site"; district: string }
  | { kind: "scaffold"; district: string; agentId: string }
  | { kind: "building"; district: string; id: BuildingId }
  | { kind: "house"; district: string; taskId: string }
  | { kind: "district"; district: string }
  | { kind: "faction"; faction: Faction }
  | { kind: "spot"; district: string; spot: Spot };

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
  setFocus(k: string | null): void;
  /** the town whose city is open (the star-system view's ground level); null = in space */
  city: string | null;
  setCity(k: string | null): void;
  /** the v3 world: layouts, islands and sprites from the payload's towns and requests */
  w25: World25 | null;
  load(p: WorldPayload): void;
  /** a newer world from the log watcher: like load, but the view (focus, city, selection, a scrubbed clock) stays */
  reload(p: WorldPayload, prepared?: Prepared): void;
  /** the heavy part of load, computed without touching the page: a reload can apply it a frame later */
  prepare(p: WorldPayload): Prepared;
  /** the same, spread over frames (each step waits for `nextFrame`) */
  prepareInFrames(p: WorldPayload, nextFrame: () => Promise<unknown>): Promise<Prepared>;
  /** sessions that need the owner now, from the server's attention stream */
  attention: Attention[];
  setAttention(a: Attention[]): void;
  /** 需要你 entries the owner closed: session → the state and moment closed (owner 2026-11-03) */
  closedAttention: Record<string, string>;
  closeAttention(a: Attention): void;
  /** share mode (spec 2026-11-01 B1/B2): code names, masked titles, neutral emblems, no diary */
  share: boolean;
  /** town key → code name while sharing */
  shareNames: Record<string, string> | null;
  /** the unmasked world while sharing */
  realW25: World25 | null;
  /** on: neutral emblems, no diary; names = code names (null keeps project names); titles: keep request titles */
  setShare(on: boolean, names?: Record<string, string> | null, titles?: boolean): void;
  shareTitles: boolean;
  /** live: the clock follows the newest record (real data opens so; scrubbing leaves it; 实时 returns) */
  following: boolean;
  /** the robot the city camera follows (spec 2026-11-05 C1): its robot id (live|…, hist|…|i, rp|…) */
  followAgent: string | null;
  setFollowAgent(id: string | null): void;
  setFollowing(f: boolean): void;
  /** a history step's moment: the world is drawn as it stood then (null = the clock) */
  historyAt: number | null;
  /** the official marks downloaded on this machine (spec 2026-11-03 C2) */
  logos: OfficialMarks;
  /** the server found no logs: the demo world is shown, and where the logs would be (spec 2026-11-03 C4) */
  emptyLogs: { claude: string; codex: string } | null;
  setEmptyLogs(r: { claude: string; codex: string } | null): void;
  setLogos(l: OfficialMarks): void;
  setHistoryAt(ts: number | null): void;
  setTime(t: number): void;
  advance(dtMs: number): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  setHovered(h: HoverTarget | null): void;
  setPointer(x: number, y: number): void;
}

let lastUi = 0;
/** what load computes from a payload, ready to be set */
export type Prepared = Pick<Store, "w25" | "events" | "source" | "unended" | "live" | "replay" | "selected" | "world" | "runtimes" | "primary" | "t0" | "duration" | "ledger" | "t" | "uiT" | "playing" | "following"> & { realW25?: World25 | null };
/** live: within this much of the newest record the clock goes at real speed (records arrive in batches) */
const FOLLOW_SLACK_MS = 15_000;
/** further behind, the extra speed per this much of extra gap */
const FOLLOW_HURRY_MS = 2_000;
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
  focus: null,
  selected: null,
  w25: null,
  live: new Set(),
  replay: null,
  select(s) {
    // the diary shows the owner's own words: never in share mode
    if (s && get().share) return;
    // a replay belongs to its town: its site, its figures and its own task keep it; anything else ends it
    const r = get().replay;
    if (r && !(s && s.district === r.district && (s.kind !== "task" || s.taskId === r.taskId))) get().stopReplay();
    set(s ? { selected: s, focus: s.district } : { selected: null });
  },
  back() {
    const { selected, focus, city, followAgent } = get();
    // one step back each time: a followed agent first (spec 2026-11-05 C1), then the selection, the city…
    if (followAgent) set({ followAgent: null });
    else if (selected) get().select(null);
    else if (city) set({ city: null });
    else if (focus) set({ focus: null });
  },
  city: null,
  setCity(k) {
    set(k ? { city: k, focus: k, followAgent: null } : { city: null, followAgent: null });
  },
  startReplay(district, events) {
    // a replay plays at its own speed: it leaves live (review 2026-11-04)
    if (get().following) set({ following: false });
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
  setFocus(k) {
    set({ focus: k });
  },
  attention: [],
  setAttention(a) {
    // forget closings of sessions that left the list: they cannot come back as they were
    const live = new Set(a.map((x) => x.session));
    const closed = Object.fromEntries(Object.entries(get().closedAttention).filter(([k]) => live.has(k)));
    if (Object.keys(closed).length !== Object.keys(get().closedAttention).length) saveClosed(closed);
    set({ attention: a, closedAttention: closed });
  },
  closedAttention: loadClosed(),
  closeAttention(a) {
    const closed = { ...get().closedAttention, [a.session]: dismissKey(a) };
    saveClosed(closed);
    set({ closedAttention: closed });
  },
  share: false,
  shareNames: null,
  realW25: null,
  shareTitles: false,
  historyAt: null,
  logos: {},
  emptyLogs: null,
  setEmptyLogs(r) {
    set({ emptyLogs: r });
  },
  setLogos(l) {
    set({ logos: l });
  },
  following: false,
  followAgent: null,
  setFollowAgent(id) {
    if (get().followAgent !== id) set({ followAgent: id });
  },
  setFollowing(f) {
    const { t, duration } = get();
    // pressing 实时 far back in the record goes straight to now; close behind, the clock walks on
    const jump = f && duration - t > 60_000 ? { t: duration, uiT: duration } : {};
    set({ following: f, ...(f ? { playing: true } : {}), ...jump });
  },
  setHistoryAt(ts) {
    set({ historyAt: ts });
  },
  setShare(on, names, titles = false) {
    const st = get();
    if (on) {
      const real = st.share ? st.realW25 : st.w25;
      set({ share: true, shareNames: names ?? null, shareTitles: titles, realW25: real, w25: real && (names || !titles) ? maskWorld(real, names ?? null, titles) : real, selected: null, hovered: null });
    } else if (st.share) {
      set({ share: false, shareNames: null, w25: st.realW25, realW25: null });
    }
  },
  reload(p, prepared) {
    const { focus, city, selected, t, duration, playing, speed, t0: oldT0, source: oldSource } = get();
    const atEnd = t >= duration;
    const wasAt = oldT0 + t;
    const following = get().following;
    const patch = sharedPatch(prepared ?? get().prepare(p), get);
    saved = null;
    const w = patch.w25;
    const still = (sel: Selection | null): Selection | null => {
      if (!sel || !w) return null;
      if (sel.kind === "request") return w.requests.has(sel.requestId) ? sel : null;
      if (sel.kind === "town") return w.towns.has(sel.district) ? sel : null;
      return sel;
    };
    const keep = (k: string | null) => (k && w?.towns.has(k) ? k : null);
    const next = patch.duration;
    const t0 = patch.t0;
    // live: the agents stay where they were and the clock walks on through the newer records — jumping to
    // the new end made them teleport (owner 2026-11-03). advance() sets the pace.
    if (following && oldSource === "real" && p.source === "real") {
      const from = Math.max(0, Math.min(next, wasAt - t0));
      set({ ...patch, focus: keep(focus), city: keep(city), selected: still(selected), t: from, uiT: from, playing: true, speed, following: true });
      return;
    }
    // one update: the new world and the kept view together, so the page redraws once
    set({ ...patch, focus: keep(focus), city: keep(city), selected: still(selected), playing, speed, following, ...(atEnd ? { t: next, uiT: next } : { t: Math.min(t, next), uiT: Math.min(t, next) }) });
  },
  load(p) {
    saved = null;
    set(sharedPatch(get().prepare(p), get));
  },
  prepare(p) {
    // the data's own words (town names, continued titles) in the page's language (spec 2026-11-05 D)
    p = localizePayload(p);
    const a = prepareClock(p);
    const ledger = buildLedger(p.events, p.buildingRows);
    return finishPrepare(p, a, ledger, get);
  },
  async prepareInFrames(p, nextFrame) {
    p = localizePayload(p);
    // three short frames instead of one long one (spec 2026-11-03 A2)
    const a = prepareClock(p);
    await nextFrame();
    const ledger = buildLedger(p.events, p.buildingRows);
    await nextFrame();
    return finishPrepare(p, a, ledger, get);
  },
  setTime(t) {
    const c = Math.max(0, Math.min(get().duration, t));
    lastUi = performance.now();
    // the owner moving the clock leaves live
    set({ t: c, uiT: c, following: false });
  },
  advance(dtMs) {
    const { playing, speed, t, duration, following } = get();
    if (following) {
      // live: real speed while close behind the newest record; far behind, hurry back to within the slack;
      // at the newest record, wait for the next
      const gap = duration - t;
      if (gap <= 0) return;
      const rate = gap > FOLLOW_SLACK_MS ? 1 + (gap - FOLLOW_SLACK_MS) / FOLLOW_HURRY_MS : 1;
      const next = Math.min(duration, t + dtMs * rate);
      const now = performance.now();
      const ui = now - lastUi >= UI_REFRESH_MS || next >= duration;
      if (ui) lastUi = now;
      set(ui ? { t: next, uiT: next } : { t: next });
      return;
    }
    if (!playing) return;
    const next = Math.min(duration, t + dtMs * speed);
    const now = performance.now();
    const ui = now - lastUi >= UI_REFRESH_MS || next >= duration;
    if (ui) lastUi = now;
    set(ui ? { t: next, uiT: next, playing: next < duration } : { t: next });
  },
  setPlaying(p) {
    const { t, duration } = get();
    // pausing leaves live
    if (!p) set({ following: false });
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


/** a prepared world as share mode stands now: masked while sharing, the real world kept aside */
function sharedPatch(patch: Prepared, get: () => Store): Prepared {
  const { share, shareNames, shareTitles } = get();
  const built = patch.realW25 ?? patch.w25;
  const w25 = built && share && (shareNames || !shareTitles) ? maskWorld(built, shareNames, shareTitles) : built;
  return { ...patch, w25, realW25: share ? built : null };
}

/** step 1 of preparing a world: the districts, their live timelines and the clock */
function prepareClock(p: WorldPayload) {
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
  if (source === "share" && p.requests.length) {
    // a shared world has no events: its clock spans its requests and opens at the end, finished
    t0 = Math.min(...p.requests.map((r) => r.startTs));
    duration = Math.max(...p.requests.map((r) => r.endTs)) - t0;
    t = duration;
  }
  const primary = runtimes.find((r) => r.timeline && r.district.faction === "claude-code") ?? runtimes.find((r) => r.timeline) ?? null;
  return { live, world, runtimes, t0, duration, unended, t, primary };
}

/** the last step: the towns and planets' data (kept where unchanged), assembled */
function finishPrepare(p: WorldPayload, a: ReturnType<typeof prepareClock>, ledger: Ledger, get: () => Store): Prepared {
  const { events, source } = p;
  const built = p.towns && p.requests ? buildWorld25(p.towns, p.requests, manifest as unknown as Manifest, a.live) : null;
  // the unmasked world: share mode is applied when the patch is set (it may change in between)
  return { realW25: built, w25: built, following: source === "real", events, source, unended: a.unended, live: a.live, replay: null, selected: null, world: a.world, runtimes: a.runtimes, primary: a.primary, t0: a.t0, duration: a.duration, ledger, t: a.t, uiT: a.t, playing: source === "demo" ? get().playing : false };
}

/** absolute timestamp of the playback clock, for ledger lookups */
export function absTime(t: number): number {
  // a history step pins the world to the moment its request finished (owner 2026-11-01)
  const s = useStore.getState();
  return s.historyAt ?? s.t0 + t;
}

export function runtimeOf(key: string): Runtime | undefined {
  return useStore.getState().runtimes.find((r) => r.district.key === key);
}
