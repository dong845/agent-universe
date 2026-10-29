// Towns of the v3 world (spec v3 4.5–4.6). Pure: the browser demo builds its towns with it too.
import type { AgentTownEvent, Faction } from "./event.ts";
import type { RequestClass, RequestRow } from "./payload.ts";
import { pickTheme, themeIds, type ThemesConfig } from "./themes.ts";

/** every non-project folder (downloads, desktop, dated scratch, temp dirs, home itself), one per faction */
export const OUTPOST = "野外营地";
/** the coding tools' own folders (~/.claude, ~/.codex, …), one per faction */
export const CAPITAL = "都城";

export type TownKind = "project" | "guild" | "capital" | "outpost";

export interface TownRow {
  /** `faction|projectId`, the district key the renderer already uses */
  key: string;
  faction: Faction;
  projectId: string;
  name: string;
  kind: TownKind;
  /** skill keys whose home this town is */
  guildOf: string[];
  theme: string;
  counts: Record<RequestClass, number>;
  /** tool calls per role, plus `spawn` (agents sent out) and `compaction` */
  workCounts: Record<string, number>;
  /** the last time a file of this town was edited */
  lastEditTs: number | null;
  /** a repository that is also a skill's guild: "<skill> 公会" */
  skillNote?: string;
}

export interface TownOptions {
  themes: ThemesConfig;
  /** `faction|projectId` → theme id, from the owner's local file */
  overrides: Record<string, string>;
  /** the skills whose home a folder is (server: from the file system; demo: a fixed map) */
  guildSkillsOf: (projectId: string) => string[];
  /** a skill's one-line description, if known on this machine */
  describe: (skillKey: string) => string | undefined;
}

const parts = (p: string) => p.split(/[\\/]/).filter(Boolean);
const SKILL_FOLDER = /[\\/]skills[\\/][^\\/]+[\\/]?$/;

export function buildTowns(requests: RequestRow[], events: AgentTownEvent[], o: TownOptions): TownRow[] {
  const known = themeIds(o.themes);
  const towns = new Map<string, TownRow>();
  for (const r of requests) {
    const key = `${r.faction}|${r.projectId}`;
    let t = towns.get(key);
    if (!t) {
      const capital = r.projectId === CAPITAL;
      const outpost = r.projectId === OUTPOST;
      const guildOf = capital || outpost ? [] : o.guildSkillsOf(r.projectId);
      const kind: TownKind = capital ? "capital" : outpost ? "outpost" : guildOf.length ? "guild" : "project";
      t = { key, faction: r.faction, projectId: r.projectId, name: "", kind, guildOf, theme: "", counts: { produced: 0, investigation: 0, chat: 0, empty: 0 }, workCounts: {}, lastEditTs: null };
      towns.set(key, t);
    }
    t.counts[r.class]++;
  }
  // names: the folder's own name; a skill folder is "<skill> 公会"; two towns of one faction with one name show their parent too
  const base = (t: TownRow) => (t.kind === "capital" ? o.themes.fixed.capital.name : t.kind === "outpost" ? o.themes.fixed.outpost.name : parts(t.projectId).at(-1) ?? t.projectId);
  const seen = new Map<string, number>();
  for (const t of towns.values()) seen.set(`${t.faction}|${base(t)}`, (seen.get(`${t.faction}|${base(t)}`) ?? 0) + 1);
  for (const t of towns.values()) {
    const b = base(t);
    if (t.kind === "guild" && SKILL_FOLDER.test(t.projectId)) t.name = `${b} 公会`;
    else if ((seen.get(`${t.faction}|${b}`) ?? 0) > 1 && (t.kind === "project" || t.kind === "guild")) t.name = parts(t.projectId).slice(-2).join("/");
    else t.name = b;
    if (t.kind === "guild" && !SKILL_FOLDER.test(t.projectId)) t.skillNote = `${t.guildOf.join("、")} 公会`;
    const over = o.overrides[t.key];
    if (t.kind === "capital") t.theme = o.themes.fixed.capital.id;
    else if (t.kind === "outpost") t.theme = o.themes.fixed.outpost.id;
    else if (over && known.has(over) && over !== o.themes.fixed.capital.id && over !== o.themes.fixed.outpost.id) t.theme = over;
    else t.theme = pickTheme([b, t.guildOf.join(" "), t.guildOf.map((s) => o.describe(s) ?? "").join(" ")], o.themes);
  }
  // work done in each town, from the events (already placed in their towns)
  for (const e of events) {
    const t = towns.get(`${e.faction}|${e.projectId}`);
    if (!t) continue;
    const add = (k: string) => (t.workCounts[k] = (t.workCounts[k] ?? 0) + 1);
    if (e.kind === "tool_start") {
      if (e.role) add(e.role);
      if (e.files?.some((f) => f.access === "edit")) t.lastEditTs = Math.max(t.lastEditTs ?? -Infinity, e.ts);
    } else if (e.kind === "agent_spawn") add("spawn");
    else if (e.kind === "compaction") add("compaction");
  }
  return [...towns.values()];
}
