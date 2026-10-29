// Which skills a tool call used (spec v3 4.4). Pure: the browser demo uses it too.
import type { AgentTownEvent } from "./event.ts";

export interface SkillName {
  /** lower case, `_` read as `-`, no plugin prefix: the identity across Claude and Codex */
  key: string;
  /** as written, without the prefix */
  display: string;
  plugin?: string;
}

export function normSkill(raw: string): SkillName {
  const s = raw.trim();
  const i = s.indexOf(":");
  const plugin = i > 0 ? s.slice(0, i) : undefined;
  const display = i > 0 ? s.slice(i + 1) : s;
  return { key: display.toLowerCase().replace(/_/g, "-"), display, ...(plugin ? { plugin } : {}) };
}

const SKILL_MD = /[\\/]skills[\\/]([^\\/\s"'`]+)[\\/]SKILL\.md/gi;

/** skill keys a tool call used: the Skill tool's argument, or any SKILL.md it opened by path */
export function skillsOfEvent(e: AgentTownEvent): string[] {
  if (e.kind !== "tool_start") return [];
  const out = new Set<string>();
  if (e.tool === "Skill" && e.target) out.add(normSkill(e.target).key);
  const texts = [...(e.files ?? []).map((f) => f.path), e.target ?? ""];
  for (const t of texts) {
    for (const m of t.matchAll(SKILL_MD)) if (!m[1].startsWith(".")) out.add(normSkill(m[1]).key);
  }
  return [...out];
}
