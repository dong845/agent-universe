// The owner's town choices from the page (spec 2026-11-07 D27 A2-A5): rename, hide, merge, and undo.
// The server keeps them in ~/.agent-town/towns.json and sends a fresh world when they change.
import type { TownRow } from "../../../schema/src/towns.ts";
import { t } from "../i18n/index.ts";

export interface TownPrefs { names: Record<string, string>; hidden: string[]; merge: Record<string, string> }
export type TownChange = { name: string | null } | { hidden: boolean } | { merge: string | null };

/** one change; the error the server gave, or null */
export async function postTown(key: string, change: TownChange): Promise<string | null> {
  try {
    const r = await fetch("/api/towns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, ...change }) });
    if (r.ok) return null;
    const b = await r.json().catch(() => ({}));
    return typeof b.error === "string" ? b.error : `HTTP ${r.status}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function fetchTownPrefs(): Promise<TownPrefs | null> {
  try {
    const r = await fetch("/api/towns");
    return r.ok ? ((await r.json()) as TownPrefs) : null;
  } catch {
    return null;
  }
}

/** towns this one can merge into: same side, a real project or guild, not itself; by name */
export function mergeTargets(towns: Iterable<TownRow>, key: string): TownRow[] {
  const me = [...towns].find((x) => x.key === key);
  if (!me || me.kind === "capital" || me.kind === "outpost") return [];
  return [...towns].filter((x) => x.key !== key && x.faction === me.faction && (x.kind === "project" || x.kind === "guild")).sort((a, b) => a.name.localeCompare(b.name));
}

/** what the capital and the field camp hold, in a line (D27 A1); nothing for other towns */
export function townNote(town: Pick<TownRow, "kind">): string | null {
  return town.kind === "capital" ? t("town.capitalNote") : town.kind === "outpost" ? t("town.outpostNote") : null;
}

/** a town key's last folder, for towns that no longer exist (merged away) */
export const keyName = (key: string) => key.slice(key.indexOf("|") + 1).split(/[\\/]/).filter(Boolean).pop() ?? key;
