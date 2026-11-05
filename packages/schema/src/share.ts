// The share mask (spec 2026-11-01 B1). A shared world is rebuilt field by field from an ALLOWLIST: a
// field not named here never leaves the machine, so a field added to the payload later stays private
// until someone allows it. Browser-safe: the id and name functions come in (the server derives them
// from its secret; see packages/server/src/shareKeys.ts).
import type { AgentTownEvent } from "./event.ts";
import type { BuildingRow } from "./aggregate.ts";
import type { RequestRow, WorldPayload } from "./payload.ts";
import type { TownRow } from "./towns.ts";

export interface ShareIds {
  /** an opaque, stable replacement for an id (request, task, session, agent, tool call) */
  id(s: string): string;
  /** an opaque replacement for a town's project id (its folder) */
  town(key: string): string;
  /** a town's code name, e.g. "Kepler-07c" */
  name(key: string): string;
}

export interface ShareOptions {
  ids: ShareIds;
  /** project names (and skill names, street folders) stay; off: code names (owner 2026-11-01: on by default) */
  townNames: boolean;
  /** request titles stay — they are the owner's own words; off: what kind of request it was */
  titles: boolean;
  /** requests whose replay goes along, with their full events (reduced here) */
  replays: { requestId: string; events: AgentTownEvent[] }[];
  /** the language masked titles are written in (spec 2026-11-05 D); default Chinese */
  lang?: "zh" | "en";
}

const CLASS_TEXT: Record<"zh" | "en", Record<RequestRow["class"], string>> = {
  zh: { produced: "完成作品", investigation: "调查", chat: "问答", empty: "空请求" },
  en: { produced: "Finished work", investigation: "Investigation", chat: "Q&A", empty: "Empty request" },
};

/** what a request was, standing in for its title when titles are hidden */
export function maskedTitle(r: RequestRow, lang: "zh" | "en" = "zh"): string {
  const c = CLASS_TEXT[lang][r.class];
  return r.calls > 0 && r.class !== "chat" ? (lang === "zh" ? `${c} · ${r.calls} 次调用` : `${c} · ${r.calls} calls`) : c;
}

/** code names per town key, made unique with a "·2" suffix in key order (two towns may hash alike) */
export function codeNames(keys: string[], name: (key: string) => string): Record<string, string> {
  const used = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const k of keys) {
    const n = name(k);
    const c = (used.get(n) ?? 0) + 1;
    used.set(n, c);
    out[k] = c === 1 ? n : `${n}·${c}`;
  }
  return out;
}

export function sharePayload(p: WorldPayload, o: ShareOptions): WorldPayload {
  const { ids, townNames, titles } = o;
  const townKey = (faction: string, projectId: string) => `${faction}|${projectId}`;
  const proj = (faction: string, projectId: string) => ids.town(townKey(faction, projectId));
  const names = codeNames(p.towns.map((t) => t.key), ids.name);

  const towns: TownRow[] = p.towns.map((t) => {
    const projectId = proj(t.faction, t.projectId);
    return {
      key: townKey(t.faction, projectId),
      faction: t.faction,
      projectId,
      name: townNames ? t.name : names[t.key],
      kind: t.kind,
      guildOf: townNames ? [...t.guildOf] : [],
      theme: t.theme,
      counts: { ...t.counts },
      workCounts: { ...t.workCounts },
      lastEditTs: t.lastEditTs,
      ...(townNames && t.skillNote ? { skillNote: t.skillNote } : {}),
    };
  });

  const requests: RequestRow[] = p.requests.map((r) => ({
    requestId: ids.id(r.requestId),
    faction: r.faction,
    projectId: proj(r.faction, r.projectId),
    sessionId: ids.id(r.sessionId),
    startTs: r.startTs,
    endTs: r.endTs,
    ok: r.ok,
    title: titles && r.title ? r.title : maskedTitle(r, o.lang),
    class: r.class,
    productKind: r.productKind,
    tokens: { ...r.tokens },
    calls: r.calls,
    fails: r.fails,
    spawns: r.spawns,
    skills: townNames ? [...r.skills] : [],
    // the folder a request changed most names a street; a folder name is structure, shown with the project names
    topDir: townNames ? r.topDir : null,
    turns: r.turns,
    taskIds: r.taskIds.map(ids.id),
    // counts per kind of work: numbers under fixed role names (the history's counts as of a step)
    ...(r.work ? { work: { ...r.work } } : {}),
  }));

  const buildingRows: BuildingRow[] = p.buildingRows.map((b) => ({
    faction: b.faction,
    projectId: proj(b.faction, b.projectId),
    building: b.building,
    ts: b.ts,
    calls: b.calls,
    durationMs: b.durationMs,
    attributedInput: b.attributedInput,
    ...(b.taskId ? { taskId: ids.id(b.taskId) } : b.taskId === null ? { taskId: null } : {}),
  }));

  const opt = (s: string | undefined) => (s === undefined ? undefined : ids.id(s));
  const agent = (a: string | undefined) => (a === undefined || a === "main" ? a : ids.id(a));
  const replayEvent = (e: AgentTownEvent): AgentTownEvent => ({
    id: ids.id(e.id),
    ts: e.ts,
    faction: e.faction,
    projectId: proj(e.faction, e.projectId),
    sessionId: ids.id(e.sessionId),
    taskId: e.taskId === null ? null : ids.id(e.taskId),
    agentId: agent(e.agentId)!,
    kind: e.kind,
    raw: { file: "", line: 0 },
    ...(e.parentAgentId !== undefined ? { parentAgentId: agent(e.parentAgentId) } : {}),
    ...(e.spawnToolUseId !== undefined ? { spawnToolUseId: opt(e.spawnToolUseId) } : {}),
    ...(e.toolUseId !== undefined ? { toolUseId: opt(e.toolUseId) } : {}),
    ...(e.groupId !== undefined ? { groupId: opt(e.groupId) } : {}),
    ...(e.spawnLink ? { spawnLink: e.spawnLink } : {}),
    // the city replay sends guardians to the sentry post; any other agent type is the owner's own name
    ...(e.agentType === "guardian" ? { agentType: "guardian" } : {}),
    ...(e.role ? { role: e.role } : {}),
    ...(e.tokens ? { tokens: { ...e.tokens } } : {}),
    ...(e.contextUsed !== undefined ? { contextUsed: e.contextUsed } : {}),
    ...(e.contextMax !== undefined ? { contextMax: e.contextMax } : {}),
    ...(e.status ? { status: e.status } : {}),
    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
    ...(e.trigger ? { trigger: e.trigger } : {}),
    ...(e.triggerBy ? { triggerBy: e.triggerBy } : {}),
    ...(e.compaction ? { compaction: { preTokens: e.compaction.preTokens, postTokens: e.compaction.postTokens } } : {}),
  });

  return {
    events: [],
    buildingRows,
    liveTaskIds: [],
    generatedAt: p.generatedAt,
    source: "share",
    requests,
    towns,
    shareReplays: o.replays.map((r) => ({ requestId: ids.id(r.requestId), events: r.events.map(replayEvent) })),
  };
}
