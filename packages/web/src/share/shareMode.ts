// Entering and leaving share mode for an export (spec 2026-11-01 B1/B2). Names hidden: the server's code
// names (real data) or a stand-in (demo). Names shown: the owner's own names, but still our own emblems.
import { useStore } from "../store.ts";
import { demoCodeNames } from "./display.ts";

export interface ShareShow { townNames: boolean; titles: boolean }

export async function enterShare(show: ShareShow): Promise<void> {
  const st = useStore.getState();
  // a shared page was masked by its exporter already
  if (st.source === "share") return st.setShare(true, null, true);
  if (show.townNames) return st.setShare(true, null, show.titles);
  const keys = [...((st.realW25 ?? st.w25)?.towns.keys() ?? [])];
  const names = st.source === "real" ? ((await (await fetch("/api/share/names")).json()) as Record<string, string>) : demoCodeNames(keys);
  useStore.getState().setShare(true, names, show.titles);
}

export function leaveShare(): void {
  useStore.getState().setShare(false);
}
