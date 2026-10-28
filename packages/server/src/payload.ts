// The world as the browser gets it (spec 3, 12.7): live tasks in full; every other task summarised
// to its start, one model call per agent with that agent's summed tokens, and its end if it had
// one; building statistics pre-summed per task. Every token total the full events give at the end
// of the record, the payload gives too (tests/payload.test.ts).
import { buildingDeltas, type BuildingRow } from "../../schema/src/aggregate.ts";
import { addTokens, zeroTokens, type AgentTownEvent } from "../../schema/src/event.ts";

export interface WorldPayload {
  events: AgentTownEvent[];
  buildingRows: BuildingRow[];
  /** tasks animated in full, most recently active first */
  liveTaskIds: string[];
  generatedAt: number;
  source: "real" | "demo";
}

export const LIVE_WINDOW_MS = 600_000;
export const MAX_LIVE = 6;
const HOUR = 3_600_000;

export function compactPayload(full: AgentTownEvent[], mtimes: Map<string, number>, now: number, opts: { liveWindowMs?: number; maxLive?: number } = {}): WorldPayload {
  const window = opts.liveWindowMs ?? LIVE_WINDOW_MS;
  const maxLive = opts.maxLive ?? MAX_LIVE;

  // ---- live: no end, and a source file written within the window ------------------------------
  const ended = new Set<string>();
  const lastTs = new Map<string, number>();
  const fresh = new Set<string>();
  for (const e of full) {
    if (!e.taskId) continue;
    if (e.kind === "task_end") ended.add(e.taskId);
    lastTs.set(e.taskId, Math.max(lastTs.get(e.taskId) ?? -Infinity, e.ts));
    if (now - (mtimes.get(e.raw.file) ?? -Infinity) <= window) fresh.add(e.taskId);
  }
  const liveTaskIds = [...fresh].filter((t) => !ended.has(t)).sort((a, b) => lastTs.get(b)! - lastTs.get(a)!).slice(0, maxLive);
  const live = new Set(liveTaskIds);

  // ---- summaries ---------------------------------------------------------------------------------
  const events: AgentTownEvent[] = [];
  const sums = new Map<string, AgentTownEvent>(); // one summed model call per (task, agent) or (session, agent, hour)
  for (const e of full) {
    if (e.taskId && live.has(e.taskId)) {
      events.push(e);
      continue;
    }
    if (e.kind === "task_start" || e.kind === "task_end") {
      events.push(e);
      continue;
    }
    if (e.kind !== "model_call" || !e.tokens) continue;
    const key = e.taskId ? `t|${e.taskId}|${e.agentId}` : `s|${e.faction}|${e.projectId}|${e.sessionId}|${e.agentId}|${Math.floor(e.ts / HOUR)}`;
    const s = sums.get(key);
    if (!s) {
      sums.set(key, { ...e, id: `sum:${key}`, tokens: addTokens(zeroTokens(), e.tokens), contextUsed: undefined, contextMax: undefined, provisional: undefined });
    } else {
      s.tokens = addTokens(s.tokens!, e.tokens);
      s.ts = Math.max(s.ts, e.ts);
      if (e.model) s.model = e.model;
    }
  }
  events.push(...sums.values());
  events.sort((a, b) => a.ts - b.ts);

  // ---- building statistics of everything not live, one row per (district, building, task) -------
  const rows = new Map<string, BuildingRow>();
  const notLive = full.filter((e) => !(e.taskId && live.has(e.taskId)));
  for (const r of buildingDeltas(notLive)) {
    const ts = r.taskId ? lastTs.get(r.taskId) ?? r.ts : r.ts;
    const key = `${r.faction}|${r.projectId}|${r.building}|${r.taskId ?? `@${Math.floor(r.ts / HOUR)}`}`;
    const s = rows.get(key);
    if (!s) rows.set(key, { ...r, ts: r.taskId ? ts : r.ts });
    else {
      s.calls += r.calls;
      s.durationMs += r.durationMs;
      s.attributedInput += r.attributedInput;
      s.ts = Math.max(s.ts, r.ts);
    }
  }
  return { events, buildingRows: [...rows.values()], liveTaskIds, generatedAt: now, source: "real" };
}
