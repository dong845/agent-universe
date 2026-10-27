// Running totals per level (plan "token 逐级汇总"), indexed by time so a hover card can show the
// value as of the playback clock. The server will keep the same series; the browser only reads.
import { addTokens, zeroTokens, type AgentTownEvent, type Tokens } from "./event.ts";
import { buildingOf, type BuildingId } from "./world.ts";

export interface BuildingStats {
  calls: number;
  durationMs: number;
  /** input + cacheWrite of the model call that read this building's tool result (plan "高消耗工具") */
  attributedInput: number;
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
  building: (projectId: string, b: BuildingId) => `building:${projectId}:${b}`,
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

/** Events must already be deduped (D9). Order does not matter; they are sorted here. */
export function buildLedger(input: AgentTownEvent[]): Ledger {
  const events = [...input].sort((a, b) => a.ts - b.ts);
  const tok = new Map<string, Point<Tokens>[]>();
  const bld = new Map<string, Point<BuildingStats>[]>();
  const starts = new Map<string, AgentTownEvent>();
  const lastResult = new Map<string, BuildingId>(); // agent key → building of its last tool result

  const bump = (key: string, t: number, d: Tokens) => {
    const s = tok.get(key) ?? [];
    const prev = s.length ? s[s.length - 1].v : zeroTokens();
    s.push({ t, v: addTokens({ ...prev }, d) });
    tok.set(key, s);
  };
  const bumpB = (key: string, t: number, d: Partial<BuildingStats>) => {
    const s = bld.get(key) ?? [];
    const p = s.length ? s[s.length - 1].v : { calls: 0, durationMs: 0, attributedInput: 0 };
    s.push({
      t,
      v: {
        calls: p.calls + (d.calls ?? 0),
        durationMs: p.durationMs + (d.durationMs ?? 0),
        attributedInput: p.attributedInput + (d.attributedInput ?? 0),
      },
    });
    bld.set(key, s);
  };

  for (const e of events) {
    const agentKey = keys.agent(e);
    if (e.kind === "model_call" && e.tokens) {
      const d = e.tokens;
      for (const k of [keys.global(), keys.faction(e), keys.project(e), keys.session(e), agentKey]) bump(k, e.ts, d);
      if (e.taskId) {
        bump(keys.task(e.taskId), e.ts, d);
        if (e.agentId !== "main") bump(keys.taskSubagents(e.taskId), e.ts, d);
      }
      const b = lastResult.get(agentKey);
      if (b) {
        bumpB(keys.building(e.projectId, b), e.ts, { attributedInput: d.input + d.cacheWrite });
        lastResult.delete(agentKey);
      }
    } else if (e.kind === "tool_start" && e.toolUseId) {
      starts.set(e.toolUseId, e);
    } else if (e.kind === "tool_end" && e.toolUseId) {
      const s = starts.get(e.toolUseId);
      const b = buildingOf(s?.role);
      if (s && b) {
        bumpB(keys.building(e.projectId, b), e.ts, { calls: 1, durationMs: e.durationMs ?? e.ts - s.ts });
        lastResult.set(agentKey, b);
      }
    }
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

/** Plan "数字格式": below 1,000 the raw value, above it k / M with one decimal. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
