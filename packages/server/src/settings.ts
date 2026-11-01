// The owner's Agent Town settings (spec 2026-11-01 A3/A5), in ~/.agent-town/settings.json. A missing or
// damaged file, or a field of the wrong type, falls back to the default for that field.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Settings {
  /** macOS notifications for sessions that need the owner */
  notify: boolean;
  /** also notify when a turn finished (otherwise only the in-page list shows it) */
  notifyTurnDone: boolean;
  /** which agents have Agent Town's hooks installed (mirrors what was installed, for the switches) */
  hooks: { claude: boolean; codex: boolean };
}

export const DEFAULT_SETTINGS: Settings = { notify: true, notifyTurnDone: false, hooks: { claude: false, codex: false } };

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function readSettings(file: string): Settings {
  let raw: Record<string, any> = {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (v && typeof v === "object") raw = v;
  } catch {
    // missing or damaged: defaults
  }
  const d = DEFAULT_SETTINGS;
  return {
    notify: bool(raw.notify, d.notify),
    notifyTurnDone: bool(raw.notifyTurnDone, d.notifyTurnDone),
    hooks: { claude: bool(raw.hooks?.claude, d.hooks.claude), codex: bool(raw.hooks?.codex, d.hooks.codex) },
  };
}

export function writeSettings(file: string, s: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file);
}
