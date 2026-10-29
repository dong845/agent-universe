// The file-system side of towns (spec v3 4.4, 4.6): skill descriptions from local SKILL.md files.
// Descriptions are shown on this machine only; they never go into git, tests or prompts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** where a skill with this key may live, in both spellings */
export function skillDirs(home: string, key: string): string[] {
  const names = [...new Set([key, key.replace(/-/g, "_")])];
  return [".claude/skills", ".codex/skills", ".agents/skills"].flatMap((root) => names.map((n) => join(home, root, n)));
}

/** the first sentence (≤ 120 chars) of the first SKILL.md's frontmatter description */
export function skillDescription(dirs: string[]): string | undefined {
  for (const d of dirs) {
    const f = join(d, "SKILL.md");
    if (!existsSync(f)) continue;
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const line = fm && /^description:\s*(.+)$/m.exec(fm[1]);
    if (!line) continue;
    let v = line[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    const first = /^(.+?[.!?。！？])(\s|$)/.exec(v)?.[1] ?? v;
    return first.length > 120 ? first.slice(0, 119) + "…" : first;
  }
  return undefined;
}
