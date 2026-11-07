// Running totals per level (plan "token 逐级汇总"), indexed by time so a hover card can show the
// value as of the playback clock. The server will keep the same series; the browser only reads.
import { addTokens, zeroTokens, type AgentTownEvent, type Faction, type Tokens } from "./event.ts";
import { buildingOf, type BuildingId } from "./world.ts";

export interface BuildingStats {
  calls: number;
  durationMs: number;
  /** input + cacheWrite of the model call that read this building's tool result (plan "高消耗工具") */
  attributedInput: number;
}

/** one change to a building's statistics; the server sends history pre-summed as these */
export interface BuildingRow {
  faction: Faction;
  projectId: string;
  building: BuildingId;
  ts: number;
  calls: number;
  durationMs: number;
  attributedInput: number;
  /** the task the change belongs to (null outside tasks); used to sum rows per task */
  taskId?: string | null;
}

/**
 * Building changes in event order: a finished tool call adds a call and its time; the model call
 * that next reads that agent's tool result adds its new input (plan "高消耗工具").
 */
export function buildingDeltas(input: AgentTownEvent[]): BuildingRow[] {
  const events = [...input].sort((a, b) => a.ts - b.ts);
  const out: BuildingRow[] = [];
  const starts = new Map<string, AgentTownEvent>();
  const lastResult = new Map<string, BuildingId>(); // agent key → building of its last tool result
  for (const e of events) {
    const agentKey = keys.agent(e);
    const row = (b: BuildingId, d: Partial<BuildingRow>) =>
      out.push({ faction: e.faction, projectId: e.projectId, building: b, ts: e.ts, calls: 0, durationMs: 0, attributedInput: 0, taskId: e.taskId, ...d });
    if (e.kind === "model_call" && e.tokens) {
      const b = lastResult.get(agentKey);
      if (b) {
        row(b, { attributedInput: e.tokens.input + e.tokens.cacheWrite });
        lastResult.delete(agentKey);
      }
    } else if (e.kind === "tool_start" && e.toolUseId) {
      starts.set(e.toolUseId, e);
    } else if (e.kind === "tool_end" && e.toolUseId) {
      const s = starts.get(e.toolUseId);
      const b = buildingOf(s?.role);
      if (s && b) {
        row(b, { calls: 1, durationMs: e.durationMs ?? e.ts - s.ts });
        lastResult.set(agentKey, b);
      }
    }
  }
  return out;
}

interface Point<T> {
  t: number;
  v: T;
}

export const keys = {
  global: () => "global",
  faction: (e: Pick<AgentTownEvent, "faction">) => `faction:${e.faction}`,
  project: (e: Pick<AgentTownEvent, "projectId">) => `project:${e.projectId}`,
  session: (e: Pick<AgentTownEvent, "sessionId">) => `session:${e.sessionId}`,
  task: (taskId: string) => `task:${taskId}`,
  taskSubagents: (taskId: string) => `task-sub:${taskId}`,
  agent: (e: Pick<AgentTownEvent, "sessionId" | "agentId">) => `agent:${e.sessionId}:${e.agentId}`,
  /** a district is one faction's work on one project (a path both factions use is two districts) */
  district: (e: Pick<AgentTownEvent, "faction" | "projectId">) => `district:${e.faction}|${e.projectId}`,
  building: (e: Pick<AgentTownEvent, "faction" | "projectId">, b: BuildingId) => `building:${e.faction}|${e.projectId}:${b}`,
};

function at<T>(series: Point<T>[] | undefined, t: number, empty: T): T {
  if (!series || !series.length || series[0].t > t) return empty;
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return series[lo].v;
}

export interface Ledger {
  tokensAt(key: string, t: number): Tokens;
  buildingAt(key: string, t: number): BuildingStats;
  /** every key that has a token series */
  tokenKeys(): string[];
}

/**
 * Events must already be deduped (D9). Order does not matter; they are sorted here. `rows` are
 * building changes the events no longer carry (history summarised by the server).
 */
export function buildLedger(input: AgentTownEvent[], rows: BuildingRow[] = []): Ledger {
  const events = [...input].sort((a, b) => a.ts - b.ts);
  const tok = new Map<string, Point<Tokens>[]>();
  const bld = new Map<string, Point<BuildingStats>[]>();

  const bump = (key: string, t: number, d: Tokens) => {
    const s = tok.get(key) ?? [];
    const prev = s.length ? s[s.length - 1].v : zeroTokens();
    s.push({ t, v: addTokens({ ...prev }, d) });
    tok.set(key, s);
  };
  for (const e of events) {
    if (e.kind !== "model_call" || !e.tokens) continue;
    const d = e.tokens;
    for (const k of [keys.global(), keys.faction(e), keys.project(e), keys.district(e), keys.session(e), keys.agent(e)]) bump(k, e.ts, d);
    if (e.taskId) {
      bump(keys.task(e.taskId), e.ts, d);
      if (e.agentId !== "main") bump(keys.taskSubagents(e.taskId), e.ts, d);
    }
  }
  for (const r of [...buildingDeltas(events), ...rows].sort((a, b) => a.ts - b.ts)) {
    const key = keys.building(r, r.building);
    const s = bld.get(key) ?? [];
    const p = s.length ? s[s.length - 1].v : { calls: 0, durationMs: 0, attributedInput: 0 };
    s.push({ t: r.ts, v: { calls: p.calls + r.calls, durationMs: p.durationMs + r.durationMs, attributedInput: p.attributedInput + r.attributedInput } });
    bld.set(key, s);
  }

  return {
    tokensAt: (key, t) => at(tok.get(key), t, zeroTokens()),
    buildingAt: (key, t) => at(bld.get(key), t, { calls: 0, durationMs: 0, attributedInput: 0 }),
    tokenKeys: () => [...tok.keys()],
  };
}

export function totalOf(t: Tokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

const UNITS = {
  en: { raw: 1000, steps: [[1e3, "k"], [1e6, "M"], [1e9, "B"]] },
  zh: { raw: 10_000, steps: [[1e4, "万"], [1e8, "亿"]] },
} as const;

/**
 * Plan "数字格式" (D27 B1): below 1,000 the raw value, then k / M / B with one decimal; in Chinese below
 * 10,000 raw, then 万 / 亿. A value that would round up to the next unit ("1000.0k") takes that unit.
 */
export function formatCount(n: number, units: "en" | "zh" = "en"): string {
  const u = UNITS[units];
  if (Math.abs(n) < u.raw) return String(n);
  const steps = u.steps;
  for (let i = 0; i < steps.length; i++) {
    const [size, name] = steps[i];
    const v = Number((n / size).toFixed(1));
    if (i === steps.length - 1 || Math.abs(v) < steps[i + 1][0] / size) return `${v.toFixed(1)}${name}`;
  }
  return String(n);
}
