// Which town a request belongs to (owner decision 2026-10-28, rules v3 spec 4.5): the town holding
// most of the files the request touched — a skill's guild, a repository (worktrees counted for their
// main repo), the tools' capital, a marked project folder, the folder the session started in — and
// the outpost for everything else. A request that touched no files falls back to its working
// directory. Every turn of a request lands in the same town; task_start records which rule placed
// it (`projectBy`), so the UI can say "按文件推断".
// D28 (owner 2026-11-07): there is no outpost any more. Temp folders and loose folders are no town:
// a file there gives no vote, so the request goes to the project it touched or started in, and work
// that belongs to no project (started at home, in a loose or temp folder) goes to the capital.
import { existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import { CAPITAL } from "../../schema/src/towns.ts";
import { gitRoot, mainRepoOf } from "./projectRoot.ts";
import { guildSkillsOf } from "./townsFs.ts";

export { CAPITAL };
const MARKERS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "README.md", "README"];
/** folders directly under home that hold unrelated things, never a project by themselves */
const LOOSE = new Set(["Downloads", "Desktop", "Documents", "Pictures", "Movies", "Music", "Public", "Library"]);
const DATED = /^\d{4}-\d{2}-\d{2}/;
/** folders tools write their output into: never a town of their own, the folder holding them is */
const OUTPUT = new Set(["assets", ".assets", "generated", "output", "outputs", "build", "dist", "tmp", "temp", "cache", ".cache", "renders", "video_out", "exports"]);
/** names that are output folders inside a deck in Downloads/Desktop/Documents, but may be projects elsewhere */
const OUTPUT_IN_LOOSE = new Set(["video", "videos", "images", "media", "frames", "out", "export"]);
const SKILL_DIR = /^(.*[\\/]skills[\\/]([A-Za-z0-9@+_.-]+))(?:[\\/]|$)/;
/** a logged path worth placing: not a whole patch or command run together into one "path" */
const sane = (p: string) => p.length <= 1024 && !/[\u0000-\u001f]|\\n/.test(p);
const FILE_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write", "NotebookEdit"]);
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

export interface AssignOptions {
  home: string;
  /** directories whose contents count as temp work */
  tempRoots: string[];
  /** the coding tools' own folders: their contents go to the capital (skills inside them excepted) */
  toolRoots?: string[];
}

export function defaultToolRoots(home: string): string[] {
  return [join(home, ".claude"), join(home, ".codex"), join(home, ".agents")];
}

export function defaultTempRoots(): string[] {
  return [tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
}

/** directories a tool call touched, from exact tool arguments: file tools' paths and patch headers */
export function touchedDirs(e: AgentTownEvent): string[] {
  if (e.kind !== "tool_start") return [];
  // untruncated paths, when the adapter recorded them
  if (e.files?.length) return e.files.filter((f) => isAbsolute(f.path) && sane(f.path)).map((f) => dirname(f.path));
  if (!e.target) return [];
  if (e.tool && FILE_TOOLS.has(e.tool)) {
    if (!isAbsolute(e.target) || !sane(e.target)) return [];
    // a target clipped with "…" is still good for its directory
    return [dirname(e.target)];
  }
  if (e.tool === "apply_patch") {
    // a relative patch path needs an absolute cwd; never resolve against this process's directory
    return [...(e.target.includes("\n") ? e.target : e.target.replace(/\\n/g, "\n")).matchAll(PATCH_FILE)].map((m) => m[1].trim()).filter((p) => sane(p) && (isAbsolute(p) || isAbsolute(e.projectId))).map((p) => dirname(resolve(e.projectId, p)));
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
  const tools = [...new Set((o.toolRoots ?? []).flatMap((t) => [t, real(t)]))];
  const homes = [...new Set([o.home, real(o.home)])];
  const isTemp = (d: string) => temps.some((t) => inside(d, t));
  const isTool = (d: string) => tools.some((t) => inside(d, t));
  const atHome = (d: string) => homes.includes(d);
  /** home itself, its standard folders and dated scratch folders hold unrelated things */
  const loose = (d: string) => atHome(d) || (atHome(dirname(d)) && LOOSE.has(basename(d))) || DATED.test(basename(d));
  /** an output folder (assets/generated, .assets, build…) lifted to the folder that holds it */
  const underLoose = (p: string) => {
    for (let x = p; !atHome(x) && dirname(x) !== x; x = dirname(x)) if (atHome(dirname(x)) && LOOSE.has(basename(x))) return true;
    return false;
  };
  const isOutput = (x: string) => OUTPUT.has(basename(x).toLowerCase()) || (OUTPUT_IN_LOOSE.has(basename(x).toLowerCase()) && underLoose(x));
  const lift = (d: string) => {
    let x = d;
    while (isOutput(x) && !gitRoot(x) && !marked(x) && !atHome(dirname(x)) && dirname(x) !== x) x = dirname(x);
    return x;
  };
  /** the nearest folder at or above d, and below home, holding a project marker */
  const marked = (d: string): string | undefined => {
    for (let x = d; !atHome(x) && dirname(x) !== x; x = dirname(x)) {
      if (MARKERS.some((m) => existsSync(join(x, m)))) return x;
    }
    return undefined;
  };
  /** spec v3 4.5, first match wins; d is the real path, raw the logged one; "" = no town (D28) */
  const place = (d: string, raw: string, cwd: string): string => {
    if (isTemp(raw) || isTemp(d)) return "";
    const repo = gitRoot(d);
    const skill = SKILL_DIR.exec(d);
    if (skill && !skill[2].startsWith(".")) return repo && inside(skill[1], repo) ? mainRepoOf(repo) : skill[1];
    if (repo) return mainRepoOf(repo);
    if (isTool(raw) || isTool(d)) return CAPITAL;
    const m = marked(d);
    if (m) return m;
    // the folder the session started in, when the file lies under it and it is not a loose folder
    if (isAbsolute(cwd)) {
      const c = lift(real(cwd));
      if ((inside(d, c) || inside(raw, cwd)) && !loose(c) && !isTemp(c) && !isTool(c)) return c;
    }
    return "";
  };
  const memo = new Map<string, string>();
  /** a touched directory → its town */
  const ofDir = (dir: string, cwd: string): string => {
    const key = `${dir}\0${cwd}`;
    let r = memo.get(key);
    if (r === undefined) memo.set(key, (r = place(real(dir), dir, cwd)));
    return r;
  };
  /** a working directory → its town by the same rules; a non-path cwd ("unknown") stays as it is */
  const ofCwd = (cwd: string): string => {
    if (!isAbsolute(cwd)) return cwd;
    const c = lift(real(cwd));
    const t = place(c, cwd, "");
    if (t) return t;
    return loose(c) || isTemp(c) || isTemp(cwd) ? CAPITAL : c;
  };
  return { ofDir, ofCwd };
}

/**
 * rewrites every event's projectId in place; marks task_start with projectBy. `requestOf` (taskId →
 * requestId) makes all turns of a request vote together and land together; without it each task is
 * its own request.
 */
export function assignProjects(events: AgentTownEvent[], o: AssignOptions, requestOf?: Map<string, string>): void {
  const place = makePlacer(o);
  const req = (taskId: string) => requestOf?.get(taskId) ?? taskId;
  // votes per task: exact (file tools, patches) and inferred (shell paths), counted apart
  const exact = new Map<string, Map<string, number>>();
  const inferred = new Map<string, Map<string, number>>();
  const vote = (box: Map<string, Map<string, number>>, taskId: string, dir: string, cwd: string) => {
    const town = place.ofDir(dir, cwd);
    if (!town) return; // a temp or loose folder: no vote (D28)
    const v = box.get(taskId) ?? new Map<string, number>();
    v.set(town, (v.get(town) ?? 0) + 1); // ties: the town touched first wins (Map keeps insertion order)
    box.set(taskId, v);
  };
  // reading a skill's instructions is using the skill, not working on it: only edits vote for its guild
  const inSkill = (d: string) => SKILL_DIR.test(d);
  for (const e of events) {
    if (!e.taskId) continue;
    const reads = e.tool === "Read" || (!!e.files?.length && e.files.every((f) => f.access === "read"));
    for (const d of touchedDirs(e)) if (!(reads && inSkill(d))) vote(exact, req(e.taskId), d, e.projectId);
    for (const d of shellDirs(e, o.home)) if (!inSkill(d)) vote(inferred, req(e.taskId), d, e.projectId);
  }
  // Precedence: a real town by exact paths, a real town by inferred paths, then the capital. Its
  // files are by-products (settings, memory, logs): they decide only when nothing else does.
  const weak = (t: string) => t === CAPITAL;
  const winner = (v: Map<string, number> | undefined, temp: boolean): string | undefined => {
    const c = [...(v ?? [])].filter(([t]) => weak(t) === temp);
    return c.length ? c.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : undefined;
  };
  // the working directory of each request's first turn, by the same rules
  const cwdMemo = new Map<string, string>();
  const ofCwd = (cwd: string) => {
    let c = cwdMemo.get(cwd);
    if (c === undefined) cwdMemo.set(cwd, (c = place.ofCwd(cwd)));
    return c;
  };
  const firstCwd = new Map<string, string>();
  // the turn's own cwd when logged (a session started at home may have moved into a project), else the session's
  for (const e of events) if (e.kind === "task_start" && e.taskId && !firstCwd.has(req(e.taskId))) firstCwd.set(req(e.taskId), ofCwd(e.cwd ?? e.projectId));
  const byTask = new Map<string, { town: string; by: "files" | "inferred" }>();
  for (const taskId of new Set([...exact.keys(), ...inferred.keys()])) {
    const e = exact.get(taskId);
    const i = inferred.get(taskId);
    const real = winner(e, false) ?? winner(i, false);
    // the tools' files (memory, settings) are by-products: a session started in a project stays there (D28)
    const home = firstCwd.get(taskId);
    if (!real && home && home !== CAPITAL) continue;
    const pick: [string | undefined, "files" | "inferred"][] = [[winner(e, false), "files"], [winner(i, false), "inferred"], [winner(e, true), "files"], [winner(i, true), "inferred"]];
    const [town, by] = pick.find(([t]) => t !== undefined)!;
    byTask.set(taskId, { town: town!, by });
  }
  // a request placed by no file: the working directory of its first turn, for every turn
  const byCwd = new Map<string, string>();
  for (const e of events) {
    if (e.kind !== "task_start" || !e.taskId) continue;
    const r = req(e.taskId);
    if (!byTask.has(r) && !byCwd.has(r)) byCwd.set(r, firstCwd.get(r) ?? ofCwd(e.projectId));
  }
  mergeSkillCopies(byTask, byCwd);
  for (const e of events) {
    const r = e.taskId ? req(e.taskId) : undefined;
    const hit = r ? byTask.get(r) : undefined;
    if (e.kind === "task_start") e.projectBy = hit?.by ?? "cwd";
    e.projectId = hit ? hit.town : (r && byCwd.get(r)) || ofCwd(e.projectId);
  }
}

const SKILL_FOLDER = /[\\/]skills[\\/]([A-Za-z0-9@+_.-]+)$/;
const skillKey = (name: string) => name.toLowerCase().replace(/_/g, "-");

/**
 * one guild per skill: a skill folder outside any repository (an installed copy, a build output)
 * joins the repository that holds the same skill under skills/<name>/, if any town is one; else
 * all copies join the copy with the most requests
 */
function mergeSkillCopies(byTask: Map<string, { town: string }>, byCwd: Map<string, string>): void {
  const uses = new Map<string, number>();
  for (const v of byTask.values()) uses.set(v.town, (uses.get(v.town) ?? 0) + 1);
  for (const t of byCwd.values()) uses.set(t, (uses.get(t) ?? 0) + 1);
  const copies = new Map<string, string[]>();
  for (const t of uses.keys()) {
    const m = SKILL_FOLDER.exec(t);
    if (!m || !isAbsolute(t)) continue;
    const k = skillKey(m[1]);
    copies.set(k, [...(copies.get(k) ?? []), t]);
  }
  if (!copies.size) return;
  const into = new Map<string, string>();
  for (const [k, folders] of copies) {
    const names = [...new Set([k, k.replace(/-/g, "_"), ...folders.map((f) => basename(f))])];
    const repo = [...uses.keys()].find((t) => isAbsolute(t) && !SKILL_FOLDER.test(t) && (names.some((n) => existsSync(join(t, "skills", n, "SKILL.md"))) || guildSkillsOf(t).includes(k)));
    const target = repo ?? folders.reduce((a, b) => ((uses.get(b) ?? 0) > (uses.get(a) ?? 0) ? b : a));
    for (const f of folders) if (f !== target) into.set(f, target);
  }
  for (const v of byTask.values()) v.town = into.get(v.town) ?? v.town;
  for (const [r, t] of byCwd) byCwd.set(r, into.get(t) ?? t);
}
