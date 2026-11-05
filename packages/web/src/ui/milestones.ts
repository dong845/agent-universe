// Celebrations (spec 2026-11-05 C4): milestones reached while the page is open — the 10th, 50th, 100th,
// 250th, 500th, 1000th finished piece of work; each tenth of a Dyson shell lit; a project's first
// finished piece. Never on the first load (that is history, not news), each only once (remembered).
import type { Faction } from "../../../schema/src/event.ts";

export interface Counts {
  /** finished pieces, both stars */
  products: number;
  shells: Partial<Record<Faction, { lit: number; total: number }>>;
  /** finished pieces per town key */
  projects: Record<string, number>;
}
export type Milestone = { id: string; kind: "products"; n: number; where: "" } | { id: string; kind: "shell"; n: number; where: Faction } | { id: string; kind: "first"; where: string };

const THRESHOLDS = [10, 50, 100, 250, 500, 1000];

const KEY = "agent-universe:milestones";
export function loadSeen(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
export function saveSeen(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    // not remembered: a milestone may show again after a reload
  }
}

export function newMilestones(prev: Counts | null, next: Counts, seen: ReadonlySet<string>): Milestone[] {
  if (!prev) return [];
  const out: Milestone[] = [];
  for (const n of THRESHOLDS) if (prev.products < n && next.products >= n) out.push({ id: `products-${n}`, kind: "products", n, where: "" });
  for (const [f, s] of Object.entries(next.shells) as [Faction, { lit: number; total: number }][]) {
    const was = prev.shells[f];
    if (!s.total) continue;
    const from = was ? Math.floor((was.lit / was.total) * 10) : 0, to = Math.floor((s.lit / s.total) * 10);
    for (let p = from + 1; p <= Math.min(to, 10); p++) out.push({ id: `shell-${f}-${p * 10}`, kind: "shell", n: p * 10, where: f });
  }
  for (const [key, n] of Object.entries(next.projects)) if (n > 0 && !(prev.projects[key] > 0)) out.push({ id: `first-${key}`, kind: "first", where: key });
  return out.filter((m) => !seen.has(m.id));
}
