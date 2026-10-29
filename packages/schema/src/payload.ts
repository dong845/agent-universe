// What the browser loads: from the local server (real logs) or from the mock (?demo=1).
import type { BuildingRow } from "./aggregate.ts";
import type { TownRow } from "./towns.ts";
import type { AgentTownEvent, Faction, Tokens } from "./event.ts";

export interface WorldPayload {
  events: AgentTownEvent[];
  buildingRows: BuildingRow[];
  /** tasks animated in full, most recently active first */
  liveTaskIds: string[];
  generatedAt: number;
  source: "real" | "demo";
  /** the user's home directory (real data), named 主目录 in the world */
  home?: string;
  /** spec v3 4.7: one row per request, oldest first */
  requests: RequestRow[];
  /** spec v3 4.7: one row per town that holds a request */
  towns: TownRow[];
}

/** spec v3 4.2: what became of a request */
export type RequestClass = "produced" | "investigation" | "chat" | "empty";
/** spec v3 4.3: what a produced request mainly made */
export type ProductKind = "code" | "docs" | "slides" | "image" | "video" | "data";

/** one request: a human turn plus the system turns that continue it */
export interface RequestRow {
  requestId: string;
  faction: Faction;
  projectId: string;
  sessionId: string;
  startTs: number;
  endTs: number;
  /** false if any turn failed, true if every turn ended well, null while any turn has no end */
  ok: boolean | null;
  title?: string;
  /** the user's own words when they were a bare "可以" / "继续" and `title` names the request continued */
  asked?: string;
  class: RequestClass;
  productKind: ProductKind | null;
  tokens: Tokens;
  calls: number;
  fails: number;
  spawns: number;
  /** skill keys, in order of first use */
  skills: string[];
  /** the top-level folder (relative to the town) edited most; "." for files at the root */
  topDir: string | null;
  turns: number;
  taskIds: string[];
}
