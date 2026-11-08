// Local logs → deduped, time-sorted unified events (D9, D10), with a per-unit disk cache: a unit is
// one Claude session (main file plus its agent files) or one Codex thread (root rollout plus its
// descendants). A unit is re-read only when one of its files changed size or mtime.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ClaudeLive, parseClaudeSession, sessionFiles } from "../../adapter-claude/src/index.ts";
import { CodexLive, groupThreads, parseCodexThread, rolloutHead, type RolloutHead } from "../../adapter-codex/src/index.ts";
import type { AgentTownEvent, Tokens } from "../../schema/src/event.ts";
import { loadRoles } from "../../schema/src/roles.ts";
import { countUnknown, newStats, type ReadStats } from "../../schema/src/util.ts";
import { homedir } from "node:os";
import { requestIdsOf } from "../../schema/src/requests.ts";
import { assignProjects, defaultTempRoots, defaultToolRoots, type AssignOptions } from "./assign.ts";

/** how long after its last write a session keeps its parser for tail reads */
const LIVE_KEEP_MS = 30 * 60_000;

/** the cache entry format; the parser sources and role rules are hashed into every key as well (producerHash) */
const CACHE_VERSION = 4;

export interface LoadOptions {
  claudeRoot: string;
  codexRoot: string;
  /** null: no cache, nothing written */
  cacheDir: string | null;
  onProgress?: (done: number, total: number) => void;
  /** how tasks are placed in towns; defaults to this machine's home and temp directories */
  assign?: AssignOptions;
  /** role rules; defaults to config/roles.json */
  rolesPath?: string;
  /**
   * each unit's parsed result kept between loads of one process (the watcher reloads every few
   * seconds): an unchanged unit is then neither re-read from the cache nor re-parsed. Pruned to
   * the units of the latest load.
   */
  memo?: Map<string, CacheEntry>;
  /**
   * a parser per live unit, kept between loads: a unit whose files only grew is read from where its
   * parser stopped (spec 2026-11-03 A1). Keyed by the unit's identity (Claude main file, Codex root).
   */
  live?: Map<string, { claude?: ClaudeLive; codex?: CodexLive }>;
}

export interface Totals {
  claude: Record<string, number[]>;
  codex: Record<string, number[]>;
}

export interface Loaded {
  events: AgentTownEvent[];
  /** taskId → requestId: a human turn and the system turns that continue it (spec v3 4.1) */
  requestOf: Map<string, string>;
  /** source file → mtimeMs, for liveness */
  mtimes: Map<string, number>;
  /** per Claude session id / Codex rollout file name, for the D5 probe cross-check */
  totals: Totals;
  /** last write behind each totals key, so a session still being written is not called a mismatch */
  modified: { claude: Record<string, number>; codex: Record<string, number> };
  stats: ReadStats;
  /** records dropped as copies of an earlier session's, by "<copier> copies <owner>" */
  copied: Map<string, number>;
  /** each unit's events before the global dedupe, for per-session invariant checks */
  perUnit: AgentTownEvent[][];
  units: { claude: number; codexRollouts: number };
  parsed: number;
  cached: number;
  /** units read only from where their kept parser stopped (spec 2026-11-03 A1) */
  tailed: number;
}

interface Unit {
  key: string;
  /** stable across changes: the Claude main file, the Codex root rollout */
  id: string;
  files: string[];
  parse(stats: ReadStats): { events: AgentTownEvent[]; totals: Totals };
  /** the same through a kept parser, reading only what was appended when it can */
  tail(live: { claude?: ClaudeLive; codex?: CodexLive }, stats: ReadStats): { events: AgentTownEvent[]; totals: Totals; mode: "full" | "tail"; pending?: boolean };
}

export interface CacheEntry {
  v: number;
  key: string;
  events: AgentTownEvent[];
  totals: Totals;
  badLines: number;
  unknownKinds: [string, number][];
}

export function walk(dir: string, keep: (p: string) => boolean, depth: number, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // deleted between listing and reading (session cleanup)
    }
    if (st.isDirectory()) {
      if (depth > 0) walk(p, keep, depth - 1, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
}

const asRow = (t: Tokens) => [t.input, t.output, t.cacheRead, t.cacheWrite];

/** reads everything at once */
export function loadEvents(o: LoadOptions): Loaded {
  const g = loadSteps(o);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** the same, yielding to the event loop between units so a server can answer while it loads */
export async function loadEventsAsync(o: LoadOptions): Promise<Loaded> {
  const g = loadSteps(o);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    await new Promise((res) => setImmediate(res));
  }
}

/**
 * What a cached unit was produced with: the role rules and the parser sources. Any edit to them
 * re-reads every session, so a cache can never serve events an older parser made.
 */
function producerHash(rolesPath: string): string {
  const h = createHash("sha1").update(String(CACHE_VERSION)).update(readFileSync(rolesPath));
  for (const rel of PRODUCERS) h.update(readFileSync(producerFile(rel)));
  return h.digest("hex").slice(0, 16);
}
/** a parser source to hash: the .ts in a clone, the compiled .js in the npm package (D30 A3) */
export function producerFile(rel: string, base: string | URL = import.meta.url): URL {
  const ts = new URL(rel, base);
  if (existsSync(ts)) return ts;
  const js = new URL(rel.replace(/\.ts$/, ".js"), base);
  if (existsSync(js)) return js;
  throw new Error(`parser source missing: ${fileURLToPath(ts)}`);
}
const PRODUCERS = [
  "../../adapter-claude/src/index.ts", "../../adapter-codex/src/index.ts", "../../schema/src/event.ts",
  "../../schema/src/roles.ts", "../../schema/src/title.ts", "../../schema/src/util.ts",
];

function* loadSteps(o: LoadOptions): Generator<void, Loaded> {
  const rolesPath = o.rolesPath ?? fileURLToPath(new URL("../../../config/roles.json", import.meta.url));
  const roles = loadRoles(pathToFileURL(rolesPath));
  const producer = producerHash(rolesPath);
  const stats = newStats();
  const mtimes = new Map<string, number>();
  const sig = (files: string[]) =>
    files.map((f) => {
      let st;
      try {
        st = statSync(f);
      } catch {
        return `${f}:gone`; // deleted mid-load: the unit re-reads (and skips it) next time
      }
      mtimes.set(f, st.mtimeMs);
      return `${f}:${st.mtimeMs}:${st.size}`;
    }).join("|");

  // Claude: main sessions sit exactly one level below the root (<project>/<session>.jsonl).
  const units: Unit[] = [];
  for (const m of walk(o.claudeRoot, (p) => p.endsWith(".jsonl"), 1).filter((p) => !p.includes("/subagents/"))) {
    const files = sessionFiles(m).map((f) => f.path); // a damaged meta file is counted when the unit is parsed
    units.push({
      key: `claude:${sig(files)}`,
      id: `claude:${m}`,
      files,
      parse(st) {
        const r = parseClaudeSession(m, roles, st);
        return { events: r.events, totals: { claude: { [r.sessionId]: asRow(r.totals) }, codex: {} } };
      },
      tail(live, st) {
        live.claude ??= new ClaudeLive(m, roles);
        const r = live.claude.update(st);
        return { events: r.events, totals: { claude: { [r.sessionId]: asRow(r.totals) }, codex: {} }, mode: r.mode, pending: r.pending };
      },
    });
  }
  // Codex: every rollout, grouped into threads.
  const heads = walk(o.codexRoot, (p) => basename(p).startsWith("rollout-") && p.endsWith(".jsonl"), 6)
    .map((p) => rolloutHead(p, stats))
    .filter((h): h is RolloutHead => !!h);
  for (const thread of groupThreads(heads)) {
    const files = thread.map((h) => h.path);
    const codexTotals = (fileTotals: Map<string, Tokens>) => {
      const codex: Record<string, number[]> = {};
      for (const [file, t] of fileTotals) codex[basename(file)] = asRow(t);
      return { claude: {}, codex };
    };
    units.push({
      key: `codex:${sig([...files].sort())}`,
      id: `codex:${thread[0].path}`,
      files,
      parse(st) {
        const r = parseCodexThread(thread, roles, st);
        return { events: r.events, totals: codexTotals(r.fileTotals) };
      },
      tail(live, st) {
        live.codex ??= new CodexLive(roles);
        const r = live.codex.update(thread, st);
        return { events: r.events, totals: codexTotals(r.fileTotals), mode: r.mode, pending: r.pending };
      },
    });
  }

  if (o.cacheDir) mkdirSync(o.cacheDir, { recursive: true });
  const perUnit: AgentTownEvent[][] = [];
  const totals: Totals = { claude: {}, codex: {} };
  const modified: Loaded["modified"] = { claude: {}, codex: {} };
  let parsed = 0;
  let tailed = 0;
  let cached = 0;
  const seen = new Set<string>();
  for (const [i, u] of units.entries()) {
    const memoKey = `${producer}|${u.key}`;
    seen.add(memoKey);
    const path = o.cacheDir ? join(o.cacheDir, createHash("sha1").update(memoKey).digest("hex") + ".json") : null;
    let entry: CacheEntry | undefined = o.memo?.get(memoKey);
    if (!entry && path && existsSync(path)) {
      try {
        const e = JSON.parse(readFileSync(path, "utf8")) as CacheEntry;
        if (e.v === CACHE_VERSION && e.key === u.key) entry = e;
      } catch {
        // a damaged cache file is ignored and rewritten
      }
    }
    if (entry) {
      cached++;
    } else {
      const st = newStats();
      let r: ReturnType<Unit["tail"]>;
      try {
        if (o.live) {
          let lv = o.live.get(u.id);
          if (!lv) o.live.set(u.id, (lv = {}));
          r = u.tail(lv, st);
        } else r = { ...u.parse(st), mode: "full" };
      } catch (e) {
        // a session deleted or unreadable mid-load: skip it, count it, keep the rest
        countUnknown(stats, `unreadable unit: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
        o.onProgress?.(i + 1, units.length);
        yield;
        continue;
      }
      entry = { v: CACHE_VERSION, key: u.key, events: r.events, totals: r.totals, badLines: st.badLines, unknownKinds: [...st.unknownKinds] };
      // a tail read happens every few seconds on a live session: its disk copy waits for a full parse
      // …and so does one whose last line has no newline yet (a full parse would read it; this did not)
      if (path && r.mode === "full" && !r.pending) writeFileSync(path, JSON.stringify(entry));
      if (r.mode === "tail") tailed++;
      else parsed++;
    }
    o.memo?.set(memoKey, entry);
    // a kept parser only for a session written lately: an old one is parsed again if it ever changes
    if (o.live && Math.max(...u.files.map((f) => mtimes.get(f) ?? 0)) < Date.now() - LIVE_KEEP_MS) o.live.delete(u.id);
    stats.badLines += entry.badLines;
    for (const [k, n] of entry.unknownKinds) stats.unknownKinds.set(k, (stats.unknownKinds.get(k) ?? 0) + n);
    const last = Math.max(...u.files.map((f) => mtimes.get(f) ?? 0));
    for (const k of Object.keys(entry.totals.claude)) modified.claude[k] = last;
    for (const f of u.files) if (basename(f) in entry.totals.codex) modified.codex[basename(f)] = mtimes.get(f) ?? 0;
    Object.assign(totals.claude, entry.totals.claude);
    Object.assign(totals.codex, entry.totals.codex);
    perUnit.push(entry.events);
    o.onProgress?.(i + 1, units.length);
    yield;
  }

  if (o.memo) for (const k of [...o.memo.keys()]) if (!seen.has(k)) o.memo.delete(k);
  if (o.live) {
    const ids = new Set(units.map((u) => u.id));
    for (const k of [...o.live.keys()]) if (!ids.has(k)) o.live.delete(k);
  }

  // A continued session opens with copies of the previous session's records (same API message ids,
  // tool ids and uuids). The session that started first owns them; the copies are dropped (D9).
  perUnit.sort((a, b) => (a[0]?.ts ?? 0) - (b[0]?.ts ?? 0));
  const claudeUnits = units.filter((u) => u.key.startsWith("claude:")).length;
  const events: AgentTownEvent[] = [];
  const owner = new Map<string, string>();
  const copied = new Map<string, number>();
  for (const evs of perUnit) {
    for (const e of evs) {
      const ow = owner.get(e.id);
      if (ow === undefined) {
        owner.set(e.id, e.sessionId);
        // assignProjects rewrites projectId in place: a memo's events must stay as parsed
        events.push(o.memo ? { ...e } : e);
      } else {
        const k = `${e.sessionId.slice(0, 8)} copies ${ow.slice(0, 8)}`;
        copied.set(k, (copied.get(k) ?? 0) + 1);
      }
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  // which town each request belongs to; cached events keep the raw cwd, so this is redone every load
  const requestOf = requestIdsOf(events);
  assignProjects(events, o.assign ?? { home: homedir(), tempRoots: defaultTempRoots(), toolRoots: defaultToolRoots(homedir()) }, requestOf);
  return { events, requestOf, mtimes, totals, modified, stats, copied, perUnit, units: { claude: claudeUnits, codexRollouts: heads.length }, parsed, cached, tailed };
}
