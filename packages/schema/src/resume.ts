// The command that reopens a session in its own terminal (spec 2026-11-01 A6). Runs on this machine
// only: the folder is a real path and is never exported.
import type { Faction } from "./event.ts";

/** a POSIX shell word: plain ids stay bare, anything else is single-quoted */
function word(s: string): string {
  return /^[A-Za-z0-9._\-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function resumeCommand(faction: Faction, sessionId: string, cwd?: string): string {
  const run = faction === "codex" ? `codex resume ${word(sessionId)}` : `claude --resume ${word(sessionId)}`;
  return cwd ? `cd '${cwd.replace(/'/g, `'\\''`)}' && ${run}` : run;
}
