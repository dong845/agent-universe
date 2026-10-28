// Which town a task belongs to (owner decision 2026-10-28): the repository, or folder, holding most
// of the files the task touched. A task that touched no files falls back to its working directory.
// All temp-directory work goes to one temp site per faction. Every task_start records which rule
// placed it (`projectBy`), so the UI can say "按文件推断".
import { existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import { gitRoot } from "./projectRoot.ts";

export const TEMP_PROJECT = "临时工地";
const FILE_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write", "NotebookEdit"]);
const PATCH_FILE = /\*\*\* (?:Add|Update|Delete) File: ([^\n]+)/g;

export interface AssignOptions {
  home: string;
  /** directories whose contents count as temp work */
  tempRoots: string[];
}

export function defaultTempRoots(): string[] {
  return [tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
}

/** directories a tool call touched, from exact tool arguments: file tools' paths and patch headers */
export function touchedDirs(e: AgentTownEvent): string[] {
  if (e.kind !== "tool_start" || !e.target) return [];
  if (e.tool && FILE_TOOLS.has(e.tool)) {
    if (!isAbsolute(e.target)) return [];
    // a target clipped with "…" is still good for its directory
    return [dirname(e.target)];
  }
  if (e.tool === "apply_patch") {
    // a relative patch path needs an absolute cwd; never resolve against this process's directory
    return [...e.target.matchAll(PATCH_FILE)].map((m) => m[1].trim()).filter((p) => isAbsolute(p) || isAbsolute(e.projectId)).map((p) => dirname(resolve(e.projectId, p)));
  }
  return [];
}

const SHELL_PATH = /(?:^|[\s"'=(:])((?:~|\/)[^\s"'`;|&()<>,]*)/g;

/**
 * directories named in a shell command (spec 12.1, "推断"): absolute or ~ paths that exist now and
 * lie inside home but are not home itself. A token cut off with "…" counts by its directory.
 */
export function shellDirs(e: AgentTownEvent, home: string): string[] {
  if (e.kind !== "tool_start" || !e.target || (e.tool && FILE_TOOLS.has(e.tool)) || e.tool === "apply_patch") return [];
  const out: string[] = [];
  for (const m of e.target.matchAll(SHELL_PATH)) {
    let p = m[1];
    if (p === "~" || p.startsWith("~/")) p = join(home, p.slice(1));
    if (p.endsWith("…")) p = dirname(p);
    if (/[*?[\]{}$]/.test(p) || !inside(p, home) || p === home || p === home + sep) continue;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    out.push(st.isDirectory() ? p : dirname(p));
  }
  return out;
}

/** the real path of the deepest existing ancestor, plus the rest unchanged */
function real(dir: string): string {
  let d = dir;
  const rest: string[] = [];
  while (!existsSync(d)) {
    const up = dirname(d);
    if (up === d) return dir;
    rest.unshift(basename(d));
    d = up;
  }
  try {
    return join(realpathSync(d), ...rest);
  } catch {
    return dir;
  }
}

const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

export function makePlacer(o: AssignOptions) {
  const temps = [...new Set(o.tempRoots.flatMap((t) => [t, real(t)]))];
  const isTemp = (d: string) => temps.some((t) => inside(d, t));
  const memo = new Map<string, string>();
  /**
   * a touched directory → its town: the repo holding it; outside any repo (or once the repo is
   * deleted), the task's own working directory when the file lies under it; else a folder under home
   */
  const ofDir = (dir: string, cwd: string): string => {
    const key = `${dir}\0${cwd}`;
    let r = memo.get(key);
    if (r !== undefined) return r;
    const d = real(dir);
    if (isTemp(dir) || isTemp(d)) r = TEMP_PROJECT;
    else {
      const underCwd = isAbsolute(cwd) && cwd !== o.home && (inside(dir, cwd) || inside(d, real(cwd)));
      r = gitRoot(d) ?? (underCwd ? ofCwd(cwd) : container(d, o.home));
    }
    memo.set(key, r);
    return r;
  };
  /** a working directory → its town: the repo it is in, else itself; a non-path cwd ("unknown") stays as it is */
  const ofCwd = (cwd: string): string => {
    if (!isAbsolute(cwd)) return cwd;
    const d = real(cwd);
    if (isTemp(cwd) || isTemp(d)) return TEMP_PROJECT;
    return gitRoot(d) ?? cwd;
  };
  return { ofDir, ofCwd };
}

/** outside any repo: the second level under home (~/Downloads/deck), else the first two levels */
function container(d: string, home: string): string {
  if (inside(d, home)) {
    const segs = relative(home, d).split(sep).filter(Boolean);
    return segs.length ? join(home, ...segs.slice(0, 2)) : home;
  }
  const segs = d.split(sep).filter(Boolean);
  return sep + segs.slice(0, 2).join(sep);
}

/** rewrites every event's projectId in place; marks task_start with projectBy */
export function assignProjects(events: AgentTownEvent[], o: AssignOptions): void {
  const place = makePlacer(o);
  // votes per task: exact (file tools, patches) and inferred (shell paths), counted apart
  const exact = new Map<string, Map<string, number>>();
  const inferred = new Map<string, Map<string, number>>();
  const vote = (box: Map<string, Map<string, number>>, taskId: string, dir: string, cwd: string) => {
    const town = place.ofDir(dir, cwd);
    if (town === o.home) return; // home is the fallback, never a vote
    const v = box.get(taskId) ?? new Map<string, number>();
    v.set(town, (v.get(town) ?? 0) + 1); // ties: the town touched first wins (Map keeps insertion order)
    box.set(taskId, v);
  };
  for (const e of events) {
    if (!e.taskId) continue;
    for (const d of touchedDirs(e)) vote(exact, e.taskId, d, e.projectId);
    for (const d of shellDirs(e, o.home)) vote(inferred, e.taskId, d, e.projectId);
  }
  // Precedence: a real town by exact paths, a real town by inferred paths, then the temp site.
  // Temp files are by-products (screenshots, scratch scripts): they decide only when nothing else does.
  const winner = (v: Map<string, number> | undefined, temp: boolean): string | undefined => {
    const c = [...(v ?? [])].filter(([t]) => (t === TEMP_PROJECT) === temp);
    return c.length ? c.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : undefined;
  };
  const byTask = new Map<string, { town: string; by: "files" | "inferred" }>();
  for (const taskId of new Set([...exact.keys(), ...inferred.keys()])) {
    const e = exact.get(taskId);
    const i = inferred.get(taskId);
    const pick: [string | undefined, "files" | "inferred"][] = [[winner(e, false), "files"], [winner(i, false), "inferred"], [winner(e, true), "files"], [winner(i, true), "inferred"]];
    const [town, by] = pick.find(([t]) => t !== undefined)!;
    byTask.set(taskId, { town: town!, by });
  }
  const cwdMemo = new Map<string, string>();
  for (const e of events) {
    const hit = e.taskId ? byTask.get(e.taskId) : undefined;
    if (e.kind === "task_start") e.projectBy = hit?.by ?? "cwd";
    if (hit) {
      e.projectId = hit.town;
      continue;
    }
    let c = cwdMemo.get(e.projectId);
    if (c === undefined) cwdMemo.set(e.projectId, (c = place.ofCwd(e.projectId)));
    e.projectId = c;
  }
}
