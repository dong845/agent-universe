import type { Role } from "../../../schema/src/event.ts";
import type { CubeKind } from "../orchestrator/timeline.ts";

/** Claude faction: warm colours, rounded buildings (plan "阵营领地") */
export const FACTION = {
  ground: "#efe3cf",
  groundEdge: "#d8c6a8",
  plaza: "#e4d3b6",
  building: "#d98e5f",
  buildingDark: "#b86a45",
  roof: "#8f4a32",
  trim: "#f6ead7",
};

export const ROLE_COLOR: Record<Role, string> = {
  commander: "#c0392b",
  scout: "#2563eb",
  smith: "#7c4a1e",
  engineer: "#ea8a1a",
  inspector: "#0f8b7a",
  messenger: "#7c3aed",
  diplomat: "#4b5563",
  scribe: "#c9a227",
  painter: "#db2777",
  operator: "#0891b2",
  sentry: "#374151",
};

/** plan "数据到视觉的映射": input blue, output orange, cache read green */
export const CUBE_COLOR: Record<CubeKind, string> = {
  input: "#3b82f6",
  output: "#f97316",
  cache: "#22c55e",
};

/** subagents: dashed frame and a second colour (plan "子代理任务") */
export const SUBAGENT = "#14b8a6";
export const MAIN_FLOOR = "#e7b98a";

/** plan: backpack green < 50 %, yellow 50–80 %, red > 80 % */
export function backpackColor(ratio: number): string {
  if (ratio > 0.8) return "#dc2626";
  if (ratio >= 0.5) return "#eab308";
  return "#16a34a";
}
