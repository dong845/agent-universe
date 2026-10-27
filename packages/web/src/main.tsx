import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { demoScenario } from "../../mock/src/scenario.ts";
import { App } from "./App.tsx";
import { activeAt, floorsAt, sampleActor } from "./orchestrator/timeline.ts";
import { useStore, type HoverTarget } from "./store.ts";
import "./styles.css";

const store = useStore.getState();
store.load(demoScenario());

// ?t=<ms>&paused=1&speed=<n> open the replay at a fixed moment (screenshots, links)
const q = new URLSearchParams(location.search);
if (q.has("speed")) store.setSpeed(Number(q.get("speed")));
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
  setTime: (t: number) => useStore.getState().setTime(t),
  pause: () => useStore.getState().setPlaying(false),
  hover: (h: HoverTarget | null, x = 400, y = 300) => {
    useStore.getState().setPointer(x, y);
    useStore.getState().setHovered(h);
  },
  snapshot: () => {
    const { t, timeline } = useStore.getState();
    return {
      t,
      actors: timeline.actors.map((a) => ({ id: a.id, ...sampleActor(a, t) })),
      floors: floorsAt(timeline, t).length,
      scaffolds: timeline.scaffolds.filter((s) => t >= s.appear && (s.merge === null || t < s.merge)).map((s) => s.agentId),
      smoke: !!activeAt(timeline.smoke, t),
      cloud: !!activeAt(timeline.clouds, t),
      roof: timeline.roofAt !== null && t >= timeline.roofAt,
    };
  },
  timeline: () => useStore.getState().timeline,
  toScreen: (x: number, y: number, z: number) =>
    (window as unknown as { __agentTownProject: (x: number, y: number, z: number) => { x: number; y: number } }).__agentTownProject(x, y, z),
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
