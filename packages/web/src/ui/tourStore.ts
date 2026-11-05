// The guided tour's state (spec 2026-11-05 B1): the step (-1 = not running), its steps, the screen point
// of what the step highlights (the card sits beside it), and the closing invitation (planets pulse until
// a city is entered). Done is remembered in this browser.
import { create } from "zustand";
import { useStore } from "../store.ts";
import type { TourStep } from "./tourSteps.ts";

const KEY = "agent-universe:tour-done";

export const tourDone = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const markDone = () => {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // storage blocked: the tour shows again next time
  }
};

export const useTour = create<{
  step: number;
  steps: TourStep[];
  invite: boolean;
  /** where on screen the highlighted thing is (px), or null */
  anchor: { x: number; y: number; r?: number } | null;
  /** the world the tour was made for (the settings' replay uses it) */
  ctx: { biggest: string | null; hasRobot: boolean };
  start(steps: TourStep[]): void;
  go(i: number): void;
  /** skip or finish: remembered; finishing leaves the planets pulsing until a city is entered */
  end(invite: boolean): void;
  setAnchor(a: { x: number; y: number; r?: number } | null): void;
}>((set, get) => ({
  step: -1,
  steps: [],
  invite: false,
  anchor: null,
  ctx: { biggest: null, hasRobot: false },
  start: (steps) => set({ steps, step: steps.length ? 0 : -1, invite: false, anchor: null }),
  go: (i) => set({ step: Math.max(0, Math.min(i, get().steps.length - 1)), anchor: null }),
  end(invite) {
    markDone();
    set({ step: -1, invite, anchor: null });
  },
  setAnchor(a) {
    const b = get().anchor;
    if (a === b || (a && b && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs((a.r ?? 0) - (b.r ?? 0)) < 2)) return;
    set({ anchor: a });
  },
}));

// entering any city answers the invitation
useStore.subscribe((s, p) => {
  if (s.city && s.city !== p.city && useTour.getState().invite) useTour.setState({ invite: false });
});
