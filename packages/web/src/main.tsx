import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadWorld, ServerDown, subscribe, type Progress } from "./data.ts";
import type { Attention } from "../../schema/src/attention.ts";
import { enterShare, leaveShare } from "./share/shareMode.ts";
import { useRecorder } from "./share/recorder.ts";
import { latestEvery } from "./throttle.ts";
import type { WorldPayload } from "../../schema/src/payload.ts";

const WORLD_EVERY_MS = 30_000;
import { fromHash, requestOfTask, toHash, type Selection } from "./selection.ts";
import { Loading } from "./ui/Loading.tsx";
import { orbit } from "./galaxy/Galaxy.tsx";
import { activeAt, floorsAt, sampleActor } from "./orchestrator/timeline.ts";
import { absTime, useStore, type HoverTarget } from "./store.ts";
import "./styles.css";

const q = new URLSearchParams(location.search);
const root = createRoot(document.getElementById("root")!);
const showLoading = (p: Progress | null) => root.render(<Loading p={p} />);
showLoading(null);
let payload;
try {
  payload = await loadWorld(q.get("demo") === "1", showLoading);
} catch (e) {
  showLoading({ phase: "error", message: e instanceof ServerDown ? "本地服务未启动：在 agent-town 目录运行 node --run start" : `读取日志失败：${e instanceof Error ? e.message : String(e)}` });
  throw e;
}
const store = useStore.getState();
store.load(payload);
// a shared page: always in share mode (names were masked by the exporter; our own emblems; no diary)
if (payload.source === "share") store.setShare(true, null, true);
// real data: newer worlds and the "需要你" list arrive as the logs change
// A newer world rebuilds the page's world (~0.2 s on a big record): at most one every 30 s, never during
// a recording. The 需要你 list has its own small message and is applied at once.
if (payload.source === "real") {
  const world = latestEvery<WorldPayload>((p) => useStore.getState().reload(p), WORLD_EVERY_MS, () => !!useRecorder.getState().session);
  subscribe({ world, attention: (a) => useStore.getState().setAttention(a) });
}

// ?t=<ms>&paused=1&speed=<n> open the replay at a fixed moment (screenshots, links)
if (q.has("speed")) store.setSpeed(Number(q.get("speed")));
// ?focus=primary opens flown into the main live town instead of the whole world
// read the live state: `store` above is the snapshot taken before load(), so its fields are stale
const focusQ = q.get("focus");
if (focusQ === "primary") store.setFocus(useStore.getState().primary?.district.key ?? null);
// ?focus=<faction>|<project> opens flown into that town
else if (focusQ && useStore.getState().w25?.towns.has(focusQ)) store.setFocus(focusQ);
if (q.has("t")) store.setTime(Number(q.get("t")));
if (q.get("paused") === "1") store.setPlaying(false);
// #task=… / #site=… / #agent=… reopen a selection; selecting writes the hash back
// an old #task=… link (one turn) opens the request that turn belongs to
const open = (h: string) => {
  const s = fromHash(h);
  const w = useStore.getState().w25;
  // an old link to a turn this world does not know opens nothing (the per-turn view is gone)
  return s && w ? requestOfTask(s, w.requests.values()) : s;
};
const fromUrl = open(location.hash);
if (fromUrl) store.select(fromUrl);
useStore.subscribe((s, p) => {
  if (s.selected !== p.selected) history.replaceState(null, "", toHash(s.selected) || location.pathname + location.search);
});
// a pasted link or back/forward changes only the hash: no reload, so read it here too
window.addEventListener("hashchange", () => useStore.getState().select(open(location.hash)));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") useStore.getState().back();
});

/**
 * Test hook: reads the world through the same functions the renderer uses, so a browser test can
 * check that the picture follows the data.
 */
declare global {
  interface Window {
    __agentTown: unknown;
  }
}
(window as unknown as { __agentTownClosed: () => Record<string, string> }).__agentTownClosed = () => useStore.getState().closedAttention;
window.__agentTown = {
  /** every standing house and tent of a town (or all towns) on the side facing the camera, with its screen point */
  spots: (town?: string) => ((window as unknown as { __agentTownSpots?: (t?: string) => unknown[] }).__agentTownSpots?.(town) ?? []),
  state: () => {
    const s = useStore.getState();
    const cam = (window as unknown as { __agentTownCamera?: { zoom: number } }).__agentTownCamera;
    const ctl = (window as unknown as { __agentTownControls?: { target: { x: number; z: number } } }).__agentTownControls;
    return { t: s.t, abs: absTime(s.t), historyAt: s.historyAt, city: s.city, duration: s.duration, source: s.source, focus: s.focus, selected: s.selected, replay: s.replay, zoom: cam?.zoom ?? 0, target: ctl ? { x: ctl.target.x, z: ctl.target.z } : null };
  },
  play: () => {
    orbit.frozen = false;
    useStore.getState().setPlaying(true);
  },
  /** a town's finished requests, biggest first (by calls) */
  requestsOf: (k: string) => [...(useStore.getState().w25?.requests.values() ?? [])].filter((r) => `${r.faction}|${r.projectId}` === k && r.class === "produced").sort((a, b) => b.calls - a.calls).map((r) => r.requestId),
  /** seconds on the orbit clock */
  orbitSec: () => orbit.sec,
  /** open a town's city (null = back to space) */
  enterCity: (k: string | null) => useStore.getState().setCity(k),
  /** share mode on/off (demo: stand-in code names; real data: the server's code names) */
  setShare: (on: boolean, show = { townNames: false, titles: false }) => (on ? enterShare(show) : leaveShare()),
  /** share mode on? */
  shareOn: () => useStore.getState().share,
  /** the "需要你" list, as the server's stream would set it */
  setAttention: (a: Attention[]) => useStore.getState().setAttention(a),
  setSpeed: (n: number) => useStore.getState().setSpeed(n),
  select: (s: Selection | null) => useStore.getState().select(s),
  setTime: (t: number) => useStore.getState().setTime(t),
  pause: () => useStore.getState().setPlaying(false),
  focus: (k: string | null | "primary") => useStore.getState().setFocus(k === "primary" ? useStore.getState().primary?.district.key ?? null : k),
  hover: (h: HoverTarget | null, x = 400, y = 300) => {
    useStore.getState().setPointer(x, y);
    useStore.getState().setHovered(h);
  },
  /** the world as drawn at the current playback time; `district` defaults to the primary live town */
  snapshot: (district?: string) => {
    const s = useStore.getState();
    const rt = district ? s.runtimes.find((r) => r.district.key === district) : s.primary;
    const tl = rt?.timeline;
    const t = s.t - (rt?.offset ?? 0);
    return {
      t: s.t,
      district: rt?.district.key ?? null,
      origin: rt?.district.origin ?? null,
      detail: [...s.detail],
      focus: s.focus,
      actors: tl ? tl.actors.map((a) => ({ id: a.id, ...sampleActor(a, t) })) : [],
      floors: tl ? floorsAt(tl, t).length : 0,
      scaffolds: tl ? tl.scaffolds.filter((x) => t >= x.appear && (x.merge === null || t < x.merge)).map((x) => x.agentId) : [],
      smoke: tl ? !!activeAt(tl.smoke, t) : false,
      cloud: tl ? !!activeAt(tl.clouds, t) : false,
      roof: tl ? tl.roofAt !== null && t >= tl.roofAt : false,
    };
  },
  world: () => useStore.getState().world,
  toScreen: (x: number, y: number, z: number) =>
    (window as unknown as { __agentTownProject: (x: number, y: number, z: number) => { x: number; y: number } }).__agentTownProject(x, y, z),
};

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
