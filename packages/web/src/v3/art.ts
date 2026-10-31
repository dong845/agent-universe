// Which sprite draws a spot (spec v3 7, 13.6). Task 3 adds the lookup; here, the query a layout asks.
import type { Faction } from "../../../schema/src/event.ts";

export interface ArtQuery {
  category: "landmark" | "house" | "public" | "misc" | "prop";
  theme?: string;
  kind?: string;
  variant?: "a" | "b";
  tier?: 1 | 2 | 3;
  idea?: number;
  /** public buildings: the art name of the kind of work (read, edit, run…) */
  work?: string;
  faction?: Faction;
  /** misc and props: the catalogue name (tent_a, notice, tree_round…) */
  name?: string;
}

export interface ManifestEntry {
  id: string;
  theme: string;
  category: string;
  w: number;
  h: number;
  /** footprint centre as fractions of width and height */
  anchor: [number, number];
  /** footprint width as a fraction of the image width */
  footprint: number;
  promptHash: string;
  source?: string;
}
export type Manifest = Record<string, ManifestEntry>;

export interface ResolvedArt {
  id: string;
  url: string;
  anchor: [number, number];
  footprint: number;
  /** width / height */
  aspect: number;
  /** another sprite stands in for the one asked (shown as 示意图 in the hover card) */
  fallback: boolean;
}

const THEME_CHAIN = ["craftsmen", "publishing"];
const KINDS = ["code", "docs", "slides", "image", "video", "data"];
const other = (f?: Faction): Faction => (f === "codex" ? "claude-code" : "codex");
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** the sprite for a query, along the fallback chain of spec 13.6; null when nothing can stand in */
export function resolveArt(m: Manifest, q: ArtQuery): ResolvedArt | null {
  const asked: string[] = [];
  const candidates: string[] = [];
  const themes = uniq([q.theme ?? "craftsmen", ...THEME_CHAIN]);
  switch (q.category) {
    case "house": {
      const kind = q.kind ?? "code";
      const v = q.variant ?? "a";
      asked.push(`${themes[0]}/house_${kind}_${v}`);
      for (const t of themes) candidates.push(`${t}/house_${kind}_${v}`, `${t}/house_${kind}_${v === "a" ? "b" : "a"}`);
      for (const t of themes) for (const k of KINDS) candidates.push(`${t}/house_${k}_a`, `${t}/house_${k}_b`);
      break;
    }
    case "landmark": {
      const idea = q.idea ?? 1;
      const tier = q.tier ?? 2;
      const tiers = [tier, ...[1, 2, 3].filter((x) => x !== tier).sort((a, b) => Math.abs(a - tier) - Math.abs(b - tier) || b - a)];
      asked.push(`${themes[0]}/landmark_${idea}_t${tier}`);
      for (const t of themes) for (const i of uniq([idea, 1, 2, 3, 4, 5, 6])) for (const tt of tiers) candidates.push(`${t}/landmark_${i}_t${tt}`);
      break;
    }
    case "public": {
      const w = q.work ?? "hall";
      asked.push(`shared/public_${w}_${q.faction}`);
      candidates.push(`shared/public_${w}_${q.faction}`, `shared/public_${w}_${other(q.faction)}`, `shared/public_hall_${q.faction}`, `shared/public_hall_${other(q.faction)}`);
      break;
    }
    case "misc": {
      const n = q.name ?? "";
      asked.push(`shared/misc_${n}`);
      candidates.push(`shared/misc_${n}`);
      const v = /^(.*)_([ab])$/.exec(n);
      if (v) candidates.push(`shared/misc_${v[1]}_${v[2] === "a" ? "b" : "a"}`);
      if (n.startsWith("capital_")) candidates.push(`shared/misc_capital_${other(q.faction)}`, `shared/public_hall_${q.faction}`, `shared/public_hall_${other(q.faction)}`);
      if (n === "outpost") candidates.push("shared/misc_tent_a", "shared/misc_tent_b");
      break;
    }
    case "prop":
      asked.push(`shared/prop_${q.name}`);
      candidates.push(`shared/prop_${q.name}`);
      break;
  }
  const hit = candidates.find((id) => m[id]);
  if (!hit) return null;
  const e = m[hit];
  const [theme, name] = hit.split("/");
  return { id: hit, url: `/art/${theme}/${name}.webp`, anchor: e.anchor, footprint: e.footprint, aspect: e.w / e.h, fallback: hit !== asked[0] };
}

/** a distinct landmark idea (1–6) per town of one theme, in stable key order, wrapping after six */
export function assignIdeas(towns: { key: string; theme: string }[]): Map<string, number> {
  const byTheme = new Map<string, string[]>();
  for (const t of towns) byTheme.set(t.theme, [...(byTheme.get(t.theme) ?? []), t.key]);
  const out = new Map<string, number>();
  for (const keys of byTheme.values()) [...keys].sort().forEach((k, i) => out.set(k, (i % 6) + 1));
  return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}
