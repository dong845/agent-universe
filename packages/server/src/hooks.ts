// Optional precise hooks (spec 2026-11-01 A3). Claude Code keeps hooks in ~/.claude/settings.json and
// Codex in ~/.codex/hooks.json, both as { "hooks": { <event>: [ { matcher?, hooks: [ {type, command} ] } ] } }
// (docs: code.claude.com/docs/en/hooks, learn.chatgpt.com/docs/hooks; see docs/log-formats.md).
//
// Installing merges our entries into the owner's file (never replaces it), after a byte-for-byte
// backup; uninstalling removes only entries whose command carries HOOK_MARKER. The command posts the
// hook's own stdin JSON to Agent Town and can never hold the agent up: 1 s timeout, no output (a Stop
// hook's stdout could be read as a decision), always exit 0.
import { chmodSync, copyFileSync, existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";

export const HOOK_MARKER = "agent-town-hook";
export type HookAgent = "claude" | "codex";

/** which events each agent reports to Agent Town, and the matcher for each */
const EVENTS: Record<HookAgent, { event: string; matcher?: string }[]> = {
  // a permission prompt that has waited ~6 s; and the end of every turn
  claude: [{ event: "Notification", matcher: "permission_prompt" }, { event: "Stop" }],
  // about to ask for approval; and the end of every turn
  codex: [{ event: "PermissionRequest" }, { event: "Stop" }],
};

export function hookCommand(src: HookAgent): string {
  return `curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- "http://127.0.0.1:$(cat ~/.agent-town/port 2>/dev/null || echo 5182)/api/hook?src=${src}" >/dev/null 2>&1 || true # ${HOOK_MARKER}`;
}

type Entry = { matcher?: string; hooks?: { type?: string; command?: string }[] };
type HookFile = { hooks?: Record<string, Entry[]> } & Record<string, unknown>;

const ours = (e: Entry) => !!e.hooks?.some((h) => typeof h.command === "string" && h.command.includes(HOOK_MARKER));

/** the file's JSON; a missing file is empty; a damaged one throws (and is never written) */
function readHookFile(file: string): { json: HookFile; existed: boolean } {
  if (!existsSync(file)) return { json: {}, existed: false };
  const v = JSON.parse(readFileSync(file, "utf8"));
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${file} is not a JSON object`);
  if (v.hooks !== undefined && (typeof v.hooks !== "object" || Array.isArray(v.hooks))) throw new Error(`${file}: "hooks" is not an object`);
  return { json: v, existed: true };
}

/** what the file was when read: a write is refused if it changed since (Claude Code writes it too) */
type Seen = { mtimeMs: number; size: number } | null;
const seenOf = (file: string): Seen => (existsSync(file) ? (({ mtimeMs, size }) => ({ mtimeMs, size }))(statSync(file)) : null);

/** test seam: runs between reading and writing */
export interface WriteHooks { beforeWrite?: () => void }

/**
 * Replaces the file's content atomically while keeping what the file is: through a symlink to its
 * target (a dotfile manager's link stays a link), with the original permissions (a 0600 file holding
 * tokens stays 0600), and only if nobody changed it since it was read.
 */
function writeAtomic(file: string, json: unknown, seen: Seen, w: WriteHooks = {}): void {
  w.beforeWrite?.();
  const target = existsSync(file) ? realpathSync(file) : file;
  const now = seenOf(target);
  if ((seen === null) !== (now === null) || (seen && now && (seen.mtimeMs !== now.mtimeMs || seen.size !== now.size))) {
    throw new Error(`${file} 在读取后又被改动了（可能是 Claude Code 或 Codex 正在写它），没有写入，请再试一次`);
  }
  const tmp = `${target}.agent-town.tmp`;
  writeFileSync(tmp, JSON.stringify(json, null, 2) + "\n", { mode: 0o600 });
  if (now) chmodSync(tmp, statSync(target).mode & 0o777);
  renameSync(tmp, target);
}

/** a backup path that never overwrites an earlier backup */
function backupPath(file: string): string {
  const first = `${file}.agent-town.bak`;
  if (!existsSync(first)) return first;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${file}.agent-town.${stamp}.bak`;
}

export function installHooks(file: string, agent: HookAgent, w: WriteHooks = {}): { added: string[]; backup: string | null } {
  const seen = seenOf(existsSync(file) ? realpathSync(file) : file);
  const { json, existed } = readHookFile(file);
  const hooks = (json.hooks ??= {});
  const added: string[] = [];
  for (const { event, matcher } of EVENTS[agent]) {
    const list = (hooks[event] ??= []);
    if (!Array.isArray(list)) throw new Error(`${file}: hooks.${event} is not a list`);
    if (list.some(ours)) continue;
    list.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCommand(agent), timeout: 2 } as never] });
    added.push(event);
  }
  if (!added.length) return { added, backup: null };
  let backup: string | null = null;
  if (existed) {
    backup = backupPath(file);
    copyFileSync(file, backup);
  }
  writeAtomic(file, json, seen, w);
  return { added, backup };
}

export function uninstallHooks(file: string, w: WriteHooks = {}): { removed: number } {
  if (!existsSync(file)) return { removed: 0 };
  const seen = seenOf(realpathSync(file));
  const { json } = readHookFile(file);
  if (!json.hooks) return { removed: 0 };
  let removed = 0;
  for (const [event, list] of Object.entries(json.hooks)) {
    if (!Array.isArray(list)) continue;
    const keep = list.filter((e) => !ours(e));
    removed += list.length - keep.length;
    if (keep.length) json.hooks[event] = keep;
    else if (list.length) delete json.hooks[event];
  }
  if (!removed) return { removed };
  if (!Object.keys(json.hooks).length) delete json.hooks;
  writeAtomic(file, json, seen, w);
  return { removed };
}

export function hooksInstalled(file: string): boolean {
  try {
    const { json } = readHookFile(file);
    return Object.values(json.hooks ?? {}).some((l) => Array.isArray(l) && l.some(ours));
  } catch {
    return false;
  }
}
