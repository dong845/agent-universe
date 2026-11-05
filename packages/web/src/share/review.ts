// The review poster's numbers (spec 2026-11-05 C3), from the requests (and the spawn events) of a period:
// the last 7 / 30 / 365 days, or all time. Days are the viewer's local days.
import type { AgentTownEvent, Role } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";

export type Period = "week" | "month" | "year" | "all";
const SPAN: Record<Exclude<Period, "all">, number> = { week: 7, month: 30, year: 365 };

export interface ReviewStats {
  period: Period;
  /** first and last day (YYYY-MM-DD) */
  from: string;
  to: string;
  days: { day: string; n: number }[];
  /** the longest run of active days in the period, and the run that reaches today (or yesterday) */
  streak: number;
  current: number;
  requests: number;
  products: number;
  tokens: number;
  busiest?: { key: string; n: number };
  work: { role: Role; n: number }[];
  /** subagents sent (each request's own count); their types only where the spawn events are at hand */
  spawns: number;
  subagents: { type: string; n: number }[];
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function dayKey(ts: number, tz?: string): string {
  const k = tz ?? "";
  let f = fmts.get(k);
  if (!f) fmts.set(k, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f.format(ts);
}
/** `n` calendar days back from a day key, without daylight-saving surprises */
const back = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const total = (t: RequestRow["tokens"]) => t.input + t.output + t.cacheRead + t.cacheWrite;
const NOT_WORK = new Set(["spawn", "compaction", "commander"]);

export function reviewStats(requests: readonly RequestRow[], period: Period, now: number, opts: { tz?: string; events?: readonly AgentTownEvent[] } = {}): ReviewStats {
  const today = dayKey(now, opts.tz);
  const done = requests.filter((r) => r.endTs <= now);
  let span: number;
  if (period === "all") {
    const first = done.reduce((m, r) => Math.min(m, r.endTs), Infinity);
    span = Number.isFinite(first) ? between(dayKey(first, opts.tz), today) + 1 : 1;
  } else span = SPAN[period];
  const days = Array.from({ length: span }, (_, i) => ({ day: back(today, span - 1 - i), n: 0 }));
  const index = new Map(days.map((d, i) => [d.day, i]));
  const inside = done.filter((r) => index.has(dayKey(r.endTs, opts.tz)));
  const per = new Map<string, { n: number; tokens: number }>();
  const work = new Map<string, number>();
  let tokens = 0, products = 0, spawns = 0;
  for (const r of inside) {
    days[index.get(dayKey(r.endTs, opts.tz))!].n++;
    tokens += total(r.tokens);
    if (r.class === "produced") products++;
    spawns += r.spawns ?? 0;
    const key = `${r.faction}|${r.projectId}`;
    const p = per.get(key) ?? { n: 0, tokens: 0 };
    p.n++;
    p.tokens += total(r.tokens);
    per.set(key, p);
    for (const [role, n] of Object.entries(r.work ?? {})) if (!NOT_WORK.has(role)) work.set(role, (work.get(role) ?? 0) + n);
  }
  let streak = 0, run = 0;
  for (const d of days) {
    run = d.n ? run + 1 : 0;
    streak = Math.max(streak, run);
  }
  let current = 0;
  for (let i = days.length - 1 - (days[days.length - 1]?.n ? 0 : 1); i >= 0 && days[i].n; i--) current++;
  let busiest: ReviewStats["busiest"];
  for (const [key, p] of per) {
    const b = busiest ? per.get(busiest.key)! : null;
    if (!b || p.n > b.n || (p.n === b.n && p.tokens > b.tokens)) busiest = { key, n: p.n };
  }
  const types = new Map<string, number>();
  for (const e of opts.events ?? []) {
    if (e.kind !== "agent_spawn" || !e.agentType || e.ts > now || !index.has(dayKey(e.ts, opts.tz))) continue;
    types.set(e.agentType, (types.get(e.agentType) ?? 0) + 1);
  }
  const top = <K extends string>(m: Map<K, number>, k: number) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k);
  return {
    period, from: days[0].day, to: today, days, streak, current,
    requests: inside.length, products, tokens,
    ...(busiest ? { busiest } : {}),
    work: top(work, 4).map(([role, n]) => ({ role: role as Role, n })),
    spawns,
    subagents: top(types, 3).map(([type, n]) => ({ type, n })),
  };
}
