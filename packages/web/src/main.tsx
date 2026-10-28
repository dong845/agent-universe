import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadWorld, ServerDown, type Progress } from "./data.ts";
import { Loading } from "./ui/Loading.tsx";
import { activeAt, floorsAt, sampleActor } from "./orchestrator/timeline.ts";
import { useStore, type HoverTarget } from "./store.ts";
import "./styles.css";

const q = new URLSearchParams(location.search);
const root = createRoot(document.getElementById("root")!);
const showLoading = (p: Progress | null) => root.render(<Loading p={p} />);
showLoading(null);
let payload;
try {
  payload = await loadWorld(q.get("demo") === "1", showLoading);
} catch (e) {
  showLoading({ phase: "error", message: e instanceof ServerDown ? "本地服务未启动：运行 pnpm start" : `读取日志失败：${e instanceof Error ? e.message : String(e)}` });
  throw e;
}
const store = useStore.getState();
store.load(payload);

// ?t=<ms>&paused=1&speed=<n> open the replay at a fixed moment (screenshots, links)
if (q.has("speed")) store.setSpeed(Number(q.get("speed")));
const look = q.get("look");
if (look === "toy" || look === "dusk" || look === "board") store.setLook(look);
// ?focus=primary opens flown into the main live town instead of the whole world
// read the live state: `store` above is the snapshot taken before load(), so its fields are stale
if (q.get("focus") === "primary") store.setFocus(useStore.getState().primary?.district.key ?? null);
if (q.has("t")) store.setTime(Number(q.get("t")));
if (q.get("paused") === "1") store.setPlaying(false);

/**
 * Test hook: reads the world through the same functions the renderer uses, so a browser test can
 * check that the picture follows the data.
 */
declare global {
  interface Window {
    __agentTown: unknown;
  }
}
window.__agentTown = {
  state: () => {
    const s = useStore.getState();
    return { t: s.t, duration: s.duration, source: s.source, focus: s.focus };
  },
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
