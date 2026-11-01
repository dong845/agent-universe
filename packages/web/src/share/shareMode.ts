// Entering and leaving share mode for an export (spec 2026-11-01 B1/B2). Names hidden: the server's code
// names (real data) or a stand-in (demo). Names shown: the owner's own names, but still our own emblems.
import { useStore } from "../store.ts";
import { demoCodeNames } from "./display.ts";

export async function enterShare(realNames: boolean): Promise<void> {
  const st = useStore.getState();
  // a shared page's names were masked by the exporter already
  if (realNames || st.source === "share") return st.setShare(true, null);
  const keys = [...((st.realW25 ?? st.w25)?.towns.keys() ?? [])];
  const names = st.source === "real" ? ((await (await fetch("/api/share/names")).json()) as Record<string, string>) : demoCodeNames(keys);
  useStore.getState().setShare(true, names);
}

export function leaveShare(): void {
  useStore.getState().setShare(false);
}
