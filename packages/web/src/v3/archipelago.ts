// Where every island goes (spec v3 8.2): Claude's towns west of a strait, Codex's east; on each side
// the capital at the strait, the skill guilds next, then the projects by how much was made there,
// and the outpost farthest out. Each island takes the free spot nearest its side's centre, keeping
// open sea between islands. Pure and deterministic.
import type { Faction } from "../../../schema/src/event.ts";
import type { TownKind } from "../../../schema/src/towns.ts";

/** open water between the two sides */
export const STRAIT = 24;
/** open water between neighbouring islands */
export const GAP = 6;

export interface IslandIn {
  key: string;
  faction: Faction;
  kind: TownKind;
  radius: number;
  /** how much was made there; bigger towns sit nearer the centre */
  weight: number;
}

const RANK: Record<TownKind, number> = { capital: 0, guild: 1, project: 2, outpost: 3 };

export function placeIslands(islands: IslandIn[]): Map<string, { x: number; z: number }> {
  const out = new Map<string, { x: number; z: number }>();
  for (const [faction, side] of [["claude-code", -1], ["codex", 1]] as const) {
    const mine = islands.filter((i) => i.faction === faction).sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.weight - a.weight || (a.key < b.key ? -1 : 1));
    if (!mine.length) continue;
    const placed: { x: number; z: number; r: number }[] = [];
    const first = mine[0];
    const anchor = { x: side * (STRAIT / 2 + first.radius), z: 0 };
    const clear = (x: number, z: number, r: number) => side * x - r >= STRAIT / 2 - 1e-9 && placed.every((p) => Math.hypot(p.x - x, p.z - z) >= p.r + r + GAP - 1e-9);
    for (const isl of mine) {
      if (!placed.length) {
        placed.push({ ...anchor, r: isl.radius });
        out.set(isl.key, anchor);
        continue;
      }
      // the outpost lies beyond every other island of its side
      const beyond = isl.kind === "outpost" ? Math.max(...placed.map((p) => Math.hypot(p.x - anchor.x, p.z - anchor.z))) + 1 : 0;
      let spot: { x: number; z: number } | null = null;
      for (let d = Math.max(beyond, 1.5); !spot && d < 5000; d += 1.5) {
        const n = Math.max(12, Math.ceil((2 * Math.PI * d) / 2));
        for (let k = 0; k < n; k++) {
          // start from the side facing away from the strait, so a side grows outward and along the coast
          const a = (side < 0 ? Math.PI : 0) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((2 * Math.PI) / n);
          const x = anchor.x + d * Math.cos(a), z = anchor.z + d * Math.sin(a);
          if (clear(x, z, isl.radius)) {
            spot = { x, z };
            break;
          }
        }
      }
      if (!spot) throw new Error(`no room for island ${isl.key}`);
      placed.push({ ...spot, r: isl.radius });
      out.set(isl.key, spot);
    }
  }
  return out;
}
