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
