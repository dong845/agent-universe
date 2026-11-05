// A town's history as steps (owner 2026-11-01): each request is one step, oldest first. Choosing a step
// stops the world clock at the moment that request finished, so the city stands as it was then. The
// explanation is assembled only from what the logs record — nothing is summarised or guessed.
import { create } from "zustand";
import { formatCount } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent, Role } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";
import { WORK_NAMES } from "../v3/townLayout.ts";
import type { World25 } from "../v3/world25Data.ts";
import { t, useLang } from "../i18n/index.ts";
import { formatGist } from "../i18n/gist.ts";

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

const CLASS_NAMES: Record<RequestRow["class"], string> = { produced: t("class.produced"), investigation: t("class.investigation"), chat: t("class.chat"), empty: t("class.empty") };
const PRODUCT_NAMES: Record<string, string> = { code: t("product.code"), docs: t("product.docs"), slides: t("product.slides"), image: t("product.image"), video: t("product.video"), data: t("product.data") };

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return t("dur.s", { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t("dur.m", { n: m });
  return t("dur.hm", { h: Math.floor(m / 60), m: m % 60 });
}

/** a tool call's kind of work in plain words; the main agent's spawning calls carry the role "commander" */
export const workName = (role: AgentTownEvent["role"] | undefined) => (!role ? t("street.other") : role === "commander" ? WORK_NAMES.spawn ?? t("work.spawn") : WORK_NAMES[role] ?? role);

const pad = (n: number) => String(n).padStart(2, "0");
/** one formatter for every row: creating one per call made a long list stall the page (owner 2026-11-03: 抖动) */
const DAY = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
export const stepDay = (ts: number) => DAY.format(ts);
const when = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export interface StepFacts {
  title: string;
  /** the title is the sentence made from the request's events (it had none of its own) */
  gist: boolean;
  rows: [string, string][];
  /** tool calls by kind of work, most first */
  work: { name: string; n: number }[];
  /** files the step edited, relative to the project, most edited first */
  files: { path: string; edits: number }[];
}

/** the facts of one step: the request row, plus its events when they are loaded */
export function stepFacts(r: RequestRow, events: AgentTownEvent[] | null): StepFacts {
  const rows: [string, string][] = [];
  rows.push([t("facts.time"), `${when(r.startTs)} → ${when(r.endTs).slice(11)}`]);
  rows.push([t("facts.took"), duration(r.endTs - r.startTs)]);
  rows.push([t("facts.result"), r.class === "produced" ? `${CLASS_NAMES.produced} · ${PRODUCT_NAMES[r.productKind ?? "code"] ?? r.productKind}` : CLASS_NAMES[r.class]]);
  if (r.ok === false) rows.push([t("facts.end"), t("facts.badEnd")]);
  const agents = events ? new Set(events.map((e) => e.agentId)).size : null;
  rows.push([t("facts.turns"), t("facts.turnsN", { n: r.turns }) + (agents !== null ? t("facts.agentsN", { n: agents }) : "") + (r.spawns ? t("facts.spawnsN", { n: r.spawns }) : "")]);
  rows.push([t("facts.calls"), t("facts.callsN", { n: r.calls }) + (r.fails ? t("facts.failsN", { n: r.fails }) : "")]);
  rows.push(["token", formatCount(r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite) + t("facts.outputN", { n: formatCount(r.tokens.output) })]);
  if (r.skills.length) rows.push([t("facts.skills"), r.skills.join(t("gist.sep"))]);
  if (r.topDir) rows.push([t("facts.topDir"), r.topDir === "." ? t("street.root") : r.topDir]);

  const work = new Map<string, number>();
  const files = new Map<string, number>();
  const root = r.projectId.replace(/\/+$/, "") + "/";
  for (const e of events ?? []) {
    if (e.kind !== "tool_start") continue;
    const name = workName(e.role);
    work.set(name, (work.get(name) ?? 0) + 1);
    for (const f of e.files ?? []) {
      if (f.access !== "edit") continue;
      const path = f.path.startsWith(root) ? f.path.slice(root.length) : f.path;
      files.set(path, (files.get(path) ?? 0) + 1);
    }
  }
  return {
    title: r.title ?? (r.gist ? formatGist(r.gist, useLang.getState().lang) : t("history.untitled")),
    gist: !r.title && !!r.gist,
    rows,
    work: [...work].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1)),
    files: [...files].map(([path, edits]) => ({ path, edits })).sort((a, b) => b.edits - a.edits || (a.path < b.path ? -1 : 1)),
  };
}

/**
 * A town's counts as of a moment (spec 2026-11-03 B1): calls per kind of work and Q&A requests, over
 * the requests that had ended by then. The town row only knows today's totals.
 */
export function countsAt(w: World25, town: string, ts: number): { work: Record<string, number>; chats: number } {
  const work: Record<string, number> = {};
  let chats = 0;
  for (const r of w.requests.values()) {
    if (r.endTs > ts || `${r.faction}|${r.projectId}` !== town) continue;
    if (r.class === "chat") chats++;
    for (const [k, n] of Object.entries(r.work ?? {})) work[k] = (work[k] ?? 0) + n;
  }
  return { work, chats };
}

export interface StepAgent {
  id: string;
  kind: "main" | "sub";
  role?: AgentTownEvent["role"];
  /** a subagent's type and the task it was given, as logged */
  agentType?: string;
  task?: string;
  calls: number;
  work: { name: string; n: number }[];
  /** the kind of work it did most (ties: the one it did first); none before any work */
  top?: Role;
}

/** the agents a step used: the main agent first, then each subagent in the order it was sent out */
export function stepAgents(events: AgentTownEvent[] | null): StepAgent[] {
  if (!events?.length) return [];
  const spawned = new Map<string, AgentTownEvent>();
  for (const e of events) if (e.kind === "agent_spawn" && !spawned.has(e.agentId)) spawned.set(e.agentId, e);
  const calls = new Map<string, Map<string, number>>();
  const roles = new Map<string, Map<Role, number>>();
  const order: string[] = [];
  for (const e of events) {
    if (!calls.has(e.agentId)) { calls.set(e.agentId, new Map()); order.push(e.agentId); }
    if (e.kind !== "tool_start") continue;
    const name = workName(e.role);
    const m = calls.get(e.agentId)!;
    m.set(name, (m.get(name) ?? 0) + 1);
    if (e.role && e.role !== "commander") {
      const r = roles.get(e.agentId) ?? new Map<Role, number>();
      r.set(e.role, (r.get(e.role) ?? 0) + 1);
      roles.set(e.agentId, r);
    }
  }
  const of = (id: string) => {
    const m = calls.get(id) ?? new Map<string, number>();
    const work = [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
    let top: Role | undefined;
    for (const [r, n] of roles.get(id) ?? []) if (!top || n > roles.get(id)!.get(top)!) top = r;
    return { calls: work.reduce((a, w) => a + w.n, 0), work, ...(top ? { top } : {}) };
  };
  // the main agent: the busiest agent that was not sent out by another
  const mains = order.filter((id) => !spawned.has(id)).sort((a, b) => of(b).calls - of(a).calls);
  const out: StepAgent[] = mains.slice(0, 1).map((id) => ({ id, kind: "main", role: "commander", ...of(id) }));
  for (const [id, sp] of spawned) out.push({ id, kind: "sub", role: sp.role, agentType: sp.agentType, task: sp.agentTask, ...of(id) });
  return out;
}

/** the history panel's state: which town, which step (null = closed) */
export const useHistory = create<{
  town: string | null;
  step: number | null;
  /** the chosen step's events, once loaded (shared by the panel and the agents standing in the city) */
  events: { requestId: string; ev: AgentTownEvent[] | null } | null;
  open(town: string, step: number): void;
  go(step: number): void;
  setEvents(requestId: string, ev: AgentTownEvent[] | null): void;
  close(): void;
}>((set) => ({
  town: null,
  step: null,
  events: null,
  open: (town, step) => set({ town, step }),
  go: (step) => set({ step }),
  setEvents: (requestId, ev) => set({ events: { requestId, ev } }),
  close: () => set({ town: null, step: null, events: null }),
}));
