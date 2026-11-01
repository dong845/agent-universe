// The right edge holds the diary or the history panel; the small panels move to their left then.
import { useHistory } from "../city/history.ts";
import { useStore } from "../store.ts";

export function useRightPanel(): boolean {
  const selected = useStore((s) => !!s.selected);
  const history = useHistory((s) => !!s.town);
  return selected || history;
}
