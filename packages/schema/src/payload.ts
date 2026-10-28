// What the browser loads: from the local server (real logs) or from the mock (?demo=1).
import type { BuildingRow } from "./aggregate.ts";
import type { AgentTownEvent } from "./event.ts";

export interface WorldPayload {
  events: AgentTownEvent[];
  buildingRows: BuildingRow[];
  /** tasks animated in full, most recently active first */
  liveTaskIds: string[];
  generatedAt: number;
  source: "real" | "demo";
  /** the user's home directory (real data), named 主目录 in the world */
  home?: string;
}
