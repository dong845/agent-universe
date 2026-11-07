// The owner's town choices (spec 2026-11-07 D27 A2-A5) in ~/.agent-town/towns.json: a name per town,
// towns hidden from space, and towns merged into another of the same side. A missing or damaged file,
// or an entry of the wrong shape, counts as not set; nothing here can make the world fail to load.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import { CAPITAL, OUTPOST } from "../../schema/src/towns.ts";

export interface TownPrefs {
  /** town key → the owner's name for it */
  names: Record<string, string>;
  /** town keys drawn as no planet */
  hidden: string[];
  /** town key → the town key its requests move to */
  merge: Record<string, string>;
}

export const MAX_NAME = 60;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const sideOf = (key: string) => key.slice(0, key.indexOf("|"));
const fixed = (key: string) => {
  const id = key.slice(key.indexOf("|") + 1);
  return id === CAPITAL || id === OUTPOST;
};

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, MAX_NAME);
  return s || null;
}

export function readTownPrefs(file: string): TownPrefs {
  const out: TownPrefs = { names: {}, hidden: [], merge: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return out;
  }
  if (!isObj(raw)) return out;
  if (isObj(raw.names)) for (const [k, v] of Object.entries(raw.names)) { const n = cleanName(v); if (n && k.includes("|")) out.names[k] = n; }
  if (Array.isArray(raw.hidden)) out.hidden = [...new Set(raw.hidden.filter((k): k is string => typeof k === "string" && k.includes("|")))];
  if (isObj(raw.merge)) for (const [k, v] of Object.entries(raw.merge)) {
    if (typeof v === "string" && k.includes("|") && v.includes("|") && k !== v && sideOf(k) === sideOf(v)) out.merge[k] = v;
  }
  return out;
}

export function writeTownPrefs(file: string, p: TownPrefs): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2) + "\n");
  renameSync(tmp, file);
}

/**
 * Each merged town's final target: a chain is followed to its end; a cycle, a target that does not
 * exist (its folder gone) or the capital / field camp on either side is dropped, so those requests stay put.
 */
export function resolveMerge(merge: Record<string, string>, exists: (key: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const from of Object.keys(merge)) {
    if (fixed(from)) continue;
    const seen = new Set([from]);
    let to = merge[from];
    while (merge[to] !== undefined && !seen.has(to)) { seen.add(to); to = merge[to]; }
    if (seen.has(to) || fixed(to) || !exists(to) || [...seen].some(fixed)) continue;
    out.set(from, to);
  }
  return out;
}

/** moves every event of a merged town into its target town (in place, like project assignment) */
export function applyMerge(events: Pick<AgentTownEvent, "faction" | "projectId">[], map: ReadonlyMap<string, string>): void {
  if (!map.size) return;
  for (const e of events) {
    const to = map.get(`${e.faction}|${e.projectId}`);
    if (to) (e as { projectId: string }).projectId = to.slice(to.indexOf("|") + 1);
  }
}
