// The right edge holds the diary or the history panel; the small panels move to their left then.
import { useHistory } from "../city/history.ts";
import { useStore } from "../store.ts";
import { useCityPanel } from "../city/OverviewPanel.tsx";
import { useReplay } from "../city/cityReplay.ts";

export function useRightPanel(): boolean {
  const selected = useStore((s) => !!s.selected);
  const history = useHistory((s) => !!s.town);
  // the city's overview takes the right side too (spec 2026-11-05 D26 C)
  const overview = useCityPanel((s) => s.overview);
  const inCity = useStore((s) => !!s.city);
  const replaying = useReplay((s) => !!s.r);
  return selected || history || (overview && inCity && !replaying);
}
