// The file-system side of towns (spec v3 4.4, 4.6): skill descriptions from local SKILL.md files.
// Descriptions are shown on this machine only; they never go into git, tests or prompts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { normSkill } from "../../schema/src/skills.ts";
import type { ThemesConfig } from "../../schema/src/themes.ts";
import { DEFAULT_WORLD_CONFIG, type WorldConfig } from "../../schema/src/worldConfig.ts";

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

/** config/world.json over the defaults; a missing file or key keeps the default, a wrong type is an error */
export function loadWorldConfig(path = new URL("../../../config/world.json", import.meta.url)): WorldConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_WORLD_CONFIG;
    throw new Error(`config/world.json: ${(e as Error).message}`);
  }
  const out = { ...DEFAULT_WORLD_CONFIG, productExt: { ...DEFAULT_WORLD_CONFIG.productExt } } as WorldConfig;
  for (const k of ["investigationCalls", "maxStreets"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== "number" || !(raw[k] as number >= 0)) throw new Error(`config/world.json: ${k} must be a number ≥ 0`);
    out[k] = raw[k] as number;
  }
  if (raw.landmarkTiers !== undefined) {
    const t = raw.landmarkTiers as number[];
    if (!Array.isArray(t) || t.length !== 3 || t.some((x) => typeof x !== "number")) throw new Error("config/world.json: landmarkTiers must be three numbers");
    out.landmarkTiers = [t[0], t[1], t[2]];
  }
  if (raw.productExt !== undefined) Object.assign(out.productExt, raw.productExt);
  return out;
}

const SKILL_FOLDER = /[\\/]skills[\\/]([^\\/]+)[\\/]?$/;
const frontName = (file: string): string | undefined => {
  try {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"));
    return fm ? /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(fm[1])?.[1] : undefined;
  } catch {
    return undefined;
  }
};

/** the skills whose home a folder is: a folder under skills/, its own SKILL.md, or skills/*\/SKILL.md inside it */
export function guildSkillsOf(dir: string): string[] {
  if (!isAbsolute(dir)) return [];
  const own = SKILL_FOLDER.exec(dir);
  if (own && !own[1].startsWith(".")) return [normSkill(own[1]).key];
  const out: string[] = [];
  if (existsSync(join(dir, "SKILL.md"))) out.push(normSkill(frontName(join(dir, "SKILL.md")) ?? basename(dir)).key);
  let entries: string[] = [];
  try {
    entries = readdirSync(join(dir, "skills"));
  } catch {
    // no skills folder
  }
  for (const n of entries.sort()) if (!n.startsWith(".") && existsSync(join(dir, "skills", n, "SKILL.md"))) out.push(normSkill(n).key);
  return [...new Set(out)];
}

/** the owner's theme choices, `faction|projectId` → theme id; a missing or garbled file gives none */
export function readOverrides(path: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** config/themes.json; a missing or broken file is an error (the world cannot be themed without it) */
export function loadThemes(path = new URL("../../../config/themes.json", import.meta.url)): ThemesConfig {
  const t = JSON.parse(readFileSync(path, "utf8")) as ThemesConfig;
  if (!Array.isArray(t.themes) || !t.default?.id || !t.fixed?.capital?.id || !t.fixed?.outpost?.id) throw new Error("config/themes.json: needs themes[], default and fixed.capital/outpost");
  return t;
}
