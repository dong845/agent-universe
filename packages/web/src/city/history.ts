// A town's history as steps (owner 2026-11-01): each request is one step, oldest first. Choosing a step
// stops the world clock at the moment that request finished, so the city stands as it was then. The
// explanation is assembled only from what the logs record — nothing is summarised or guessed.
import { create } from "zustand";
import { formatCount } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";
import { WORK_NAMES } from "../v3/townLayout.ts";
import type { World25 } from "../v3/world25Data.ts";

export interface HistoryStep {
  index: number;
  request: RequestRow;
  /** the city draws a building for it (a city draws at most 20 houses and 6 tents) */
  drawn: boolean;
}

export function historySteps(w: World25, town: string): HistoryStep[] {
  const layout = w.layouts.get(town);
  const drawn = new Set(layout?.spots.flatMap((s) => (s.info.kind === "house" || s.info.kind === "tent" ? [s.info.requestId] : [])) ?? []);
  return [...w.requests.values()]
    .filter((r) => `${r.faction}|${r.projectId}` === town && r.class !== "empty")
    .sort((a, b) => a.endTs - b.endTs || a.startTs - b.startTs || (a.requestId < b.requestId ? -1 : 1))
    .map((request, i) => ({ index: i + 1, request, drawn: drawn.has(request.requestId) }));
}

const CLASS_NAMES: Record<RequestRow["class"], string> = { produced: "完成作品", investigation: "调查（只读）", chat: "问答", empty: "空请求" };
const PRODUCT_NAMES: Record<string, string> = { code: "代码", docs: "文档", slides: "幻灯", image: "图片", video: "影音", data: "数据" };

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const when = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export interface StepFacts {
  title: string;
  rows: [string, string][];
  /** tool calls by kind of work, most first */
  work: { name: string; n: number }[];
  /** files the step edited, relative to the project, most edited first */
  files: { path: string; edits: number }[];
}

/** the facts of one step: the request row, plus its events when they are loaded */
export function stepFacts(r: RequestRow, events: AgentTownEvent[] | null): StepFacts {
  const rows: [string, string][] = [];
  rows.push(["时间", `${when(r.startTs)} → ${when(r.endTs).slice(11)}`]);
  rows.push(["用时", duration(r.endTs - r.startTs)]);
  rows.push(["结果", r.class === "produced" ? `${CLASS_NAMES.produced} · ${PRODUCT_NAMES[r.productKind ?? "code"] ?? r.productKind}` : CLASS_NAMES[r.class]]);
  if (r.ok === false) rows.push(["结束", "有一轮没有正常结束"]);
  const agents = events ? new Set(events.map((e) => e.agentId)).size : null;
  rows.push(["轮次 · 代理", `${r.turns} 轮${agents !== null ? ` · ${agents} 个代理` : ""}${r.spawns ? `（派出 ${r.spawns} 个子代理）` : ""}`]);
  rows.push(["工具调用", `${r.calls} 次${r.fails ? `，失败 ${r.fails} 次` : ""}`]);
  rows.push(["token", `${formatCount(r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite)}（输出 ${formatCount(r.tokens.output)}）`]);
  if (r.skills.length) rows.push(["技能", r.skills.join("、")]);
  if (r.topDir) rows.push(["改动最多在", r.topDir === "." ? "根目录" : r.topDir]);

  const work = new Map<string, number>();
  const files = new Map<string, number>();
  const root = r.projectId.replace(/\/+$/, "") + "/";
  for (const e of events ?? []) {
    if (e.kind !== "tool_start") continue;
    const name = e.role ? WORK_NAMES[e.role] ?? e.role : "其他";
    work.set(name, (work.get(name) ?? 0) + 1);
    for (const f of e.files ?? []) {
      if (f.access !== "edit") continue;
      const path = f.path.startsWith(root) ? f.path.slice(root.length) : f.path;
      files.set(path, (files.get(path) ?? 0) + 1);
    }
  }
  return {
    title: r.title ?? "（无标题）",
    rows,
    work: [...work].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1)),
    files: [...files].map(([path, edits]) => ({ path, edits })).sort((a, b) => b.edits - a.edits || (a.path < b.path ? -1 : 1)),
  };
}

/** the history panel's state: which town, which step (null = closed) */
export const useHistory = create<{ town: string | null; step: number | null; open(town: string, step: number): void; go(step: number): void; close(): void }>((set) => ({
  town: null,
  step: null,
  open: (town, step) => set({ town, step }),
  go: (step) => set({ step }),
  close: () => set({ town: null, step: null }),
}));
