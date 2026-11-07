// A project's overview (spec 2026-11-05 D26 C): how big it is — its requests by kind, finished work by
// kind, tokens, active days and streak, what its city has built, the work done most, subagents sent,
// skills used, and what runs now. Every number counts the town's own requests.
import type { Role } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";
import { reviewStats } from "../share/review.ts";
import type { World25 } from "../v3/world25Data.ts";

export interface TownOverview {
  requests: { total: number; produced: number; investigation: number; chat: number };
  products: { kind: string; n: number }[];
  tokens: number;
  activeDays: number;
  first: number | null;
  last: number | null;
  streak: number;
  built: { houses: number; suburbs: number; more: number; tents: number; streets: number; public: { work: string; n: number }[] };
  work: { role: Role; n: number }[];
  spawns: number;
  skills: { name: string; n: number }[];
  liveNow: number;
}

const desc = <T extends { n: number }>(a: T[]) => a.sort((x, y) => y.n - x.n);

export function townOverview(w: Pick<World25, "towns" | "requests" | "layouts" | "live">, key: string, now: number, tz?: string): TownOverview | null {
  const town = w.towns.get(key);
  if (!town) return null;
  const mine: RequestRow[] = [...w.requests.values()].filter((r) => `${r.faction}|${r.projectId}` === key);
  const s = reviewStats(mine, "all", now, tz ? { tz } : {});
  const kinds = new Map<string, number>();
  const skills = new Map<string, number>();
  for (const r of mine) {
    if (r.class === "produced" && r.productKind) kinds.set(r.productKind, (kinds.get(r.productKind) ?? 0) + 1);
    for (const k of new Set(r.skills)) skills.set(k, (skills.get(k) ?? 0) + 1);
  }
  const layout = w.layouts.get(key);
  const spots = layout?.spots ?? [];
  const NOT_WORK = new Set(["spawn", "compaction", "commander"]);
  return {
    requests: {
      total: mine.length,
      produced: mine.filter((r) => r.class === "produced").length,
      investigation: mine.filter((r) => r.class === "investigation").length,
      chat: mine.filter((r) => r.class === "chat" || r.class === "empty").length,
    },
    products: desc([...kinds].map(([kind, n]) => ({ kind, n }))),
    tokens: s.tokens,
    activeDays: s.days.filter((d) => d.n > 0).length,
    first: mine.length ? Math.min(...mine.map((r) => r.endTs)) : null,
    last: mine.length ? Math.max(...mine.map((r) => r.endTs)) : null,
    streak: s.streak,
    built: {
      houses: spots.filter((p) => p.info.kind === "house").length,
      suburbs: layout?.suburbs?.length ?? 0,
      more: layout?.suburbsMore ?? 0,
      tents: spots.filter((p) => p.info.kind === "tent").length,
      streets: layout?.streets.length ?? 0,
      public: desc(spots.flatMap((p) => (p.info.kind === "public" ? [{ work: p.info.work, n: p.info.count }] : []))),
    },
    work: desc(Object.entries(town.workCounts ?? {}).filter(([r]) => !NOT_WORK.has(r)).map(([role, n]) => ({ role: role as Role, n }))).slice(0, 5),
    spawns: mine.reduce((a, r) => a + (r.spawns ?? 0), 0),
    skills: desc([...skills].map(([name, n]) => ({ name, n }))),
    liveNow: mine.filter((r) => w.live.has(r.requestId)).length,
  };
}
