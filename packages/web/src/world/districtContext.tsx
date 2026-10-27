// Everything inside a district reads its district, timeline and local clock from this context, so
// the same components draw any number of districts.
import { createContext, useContext } from "react";
import type { Faction } from "../../../schema/src/event.ts";
import type { Timeline } from "../orchestrator/timeline.ts";
import { useStore, type Runtime } from "../store.ts";

export const DistrictContext = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const r = useContext(DistrictContext);
  if (!r) throw new Error("useRuntime() outside a district");
  return r;
}

/** faction of the enclosing district, or null outside one */
export function useFactionOf(): Faction | null {
  return useContext(DistrictContext)?.district.faction ?? null;
}

const EMPTY: Timeline = {
  t0: 0, duration: 0, actors: [], flights: [], floors: [], scaffolds: [], foundationAt: null, roofAt: null,
  smoke: [], clouds: [], buildingSmoke: [], hallLit: [], bubbles: [], markers: [], fastForwards: 0,
};

/** this district's timeline, or an empty one for a district with no live task */
export function useTimeline(): Timeline {
  return useRuntime().timeline ?? EMPTY;
}

/** the playback clock in this district's timeline time, at the DOM refresh rate */
export function useLocalUiT(): number {
  const off = useRuntime().offset;
  return useStore((s) => s.uiT) - off;
}

/** the playback clock in this district's timeline time, read inside useFrame */
export function localNow(r: Runtime): number {
  return useStore.getState().t - r.offset;
}
