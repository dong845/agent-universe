// Where each role works (plan "3D world design" + docs/decisions.md D11).
import type { Role } from "./event.ts";

export type BuildingId =
  | "library"
  | "forge"
  | "workshop"
  | "training"
  | "port"
  | "embassy"
  | "council"
  | "studio"
  | "control";

export const BUILDINGS: { id: BuildingId; role: Role; name: string; what: string }[] = [
  { id: "library", role: "scout", name: "图书馆", what: "读取与搜索代码" },
  { id: "forge", role: "smith", name: "锻造坊", what: "编辑" },
  { id: "workshop", role: "engineer", name: "工坊", what: "执行命令" },
  { id: "training", role: "inspector", name: "训练场", what: "测试" },
  { id: "port", role: "messenger", name: "港口", what: "网络" },
  { id: "embassy", role: "diplomat", name: "使馆", what: "MCP 外部服务" },
  { id: "council", role: "scribe", name: "议事厅", what: "规划与待办" },
  { id: "studio", role: "painter", name: "画室", what: "生图与看图" },
  { id: "control", role: "operator", name: "操控室", what: "屏幕与浏览器操作" },
];

export const ROLE_NAMES: Record<Role, string> = {
  commander: "指挥官",
  scout: "侦察兵",
  smith: "工匠",
  engineer: "工程师",
  inspector: "质检员",
  messenger: "信使",
  diplomat: "外交官",
  scribe: "书记官",
  painter: "画师",
  operator: "操作员",
  sentry: "哨兵",
};

/** The building a role walks to; commander and sentry have none (site and hall post). */
export function buildingOf(role: Role | undefined): BuildingId | undefined {
  return BUILDINGS.find((b) => b.role === role)?.id;
}
