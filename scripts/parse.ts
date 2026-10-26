// Minimal phase-0 parser: local logs → unified events, plus the D5 cross-check against the probes.
//
//   node scripts/parse.ts [--claude <root>] [--codex <root>] [--events out.jsonl]
//                         [--totals out.json] [--against probe-claude.json,probe-codex.json]
//
// Without roots it reads ~/.claude/projects and ~/.codex/sessions. It prints only counts.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseClaudeSession, sessionFiles } from "../packages/adapter-claude/src/index.ts";
import { groupThreads, parseCodexThread, rolloutHead, type RolloutHead } from "../packages/adapter-codex/src/index.ts";
import type { AgentTownEvent, Tokens } from "../packages/schema/src/event.ts";
import { loadRoles } from "../packages/schema/src/roles.ts";
import { newStats } from "../packages/schema/src/util.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function walk(dir: string, keep: (p: string) => boolean, depth: number, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (depth > 0) walk(p, keep, depth - 1, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
}

const claudeRoot = arg("--claude") ?? join(homedir(), ".claude/projects");
const codexRoot = arg("--codex") ?? join(homedir(), ".codex/sessions");
const roles = loadRoles();
const stats = newStats();
const perSession: AgentTownEvent[][] = [];
const totals: { claude: Record<string, number[]>; codex: Record<string, number[]> } = { claude: {}, codex: {} };
// last write to any file behind a totals key, so a session still being written is not called a mismatch
const modified: { claude: Record<string, number>; codex: Record<string, number> } = { claude: {}, codex: {} };
const asRow = (t: Tokens) => [t.input, t.output, t.cacheRead, t.cacheWrite];

const t0 = Date.now();
// Claude: main sessions sit exactly one level below the root (<project>/<session>.jsonl).
const mains = walk(claudeRoot, (p) => p.endsWith(".jsonl"), 1).filter((p) => !p.includes("/subagents/"));
for (const m of mains) {
  const r = parseClaudeSession(m, roles, stats);
  totals.claude[r.sessionId] = asRow(r.totals);
  modified.claude[r.sessionId] = Math.max(...sessionFiles(m).map((f) => statSync(f.path).mtimeMs));
  perSession.push(r.events);
}
// Codex: every rollout, grouped into threads.
const heads = walk(codexRoot, (p) => basename(p).startsWith("rollout-") && p.endsWith(".jsonl"), 6)
  .map((p) => rolloutHead(p, stats))
  .filter((h): h is RolloutHead => !!h);
for (const thread of groupThreads(heads)) {
  const r = parseCodexThread(thread, roles, stats);
  for (const [file, t] of r.fileTotals) {
    totals.codex[basename(file)] = asRow(t);
    modified.codex[basename(file)] = statSync(file).mtimeMs;
  }
  perSession.push(r.events);
}
const secs = (Date.now() - t0) / 1000;

// ---- fail-loud invariants ----------------------------------------------------------------
const problems: string[] = [];
for (const evs of perSession) {
  const ids = new Set<string>();
  for (const e of evs) {
    if (!Number.isFinite(e.ts)) problems.push(`event without timestamp: ${e.kind} ${e.raw.file}:${e.raw.line}`);
    if (e.tokens && Object.values(e.tokens).some((v) => v < 0)) problems.push(`negative tokens: ${e.raw.file}:${e.raw.line}`);
    if (ids.has(e.id)) problems.push(`duplicated id inside one session: ${e.kind} ${e.raw.file}:${e.raw.line}`);
    ids.add(e.id);
  }
}

// ---- global dedupe ---------------------------------------------------------------------------
// A continued session opens with copies of the previous session's records (same API message ids,
// tool ids and uuids). The session that started first owns them; the copies are dropped here,
// the way the store's unique key will drop them.
perSession.sort((a, b) => (a[0]?.ts ?? 0) - (b[0]?.ts ?? 0));
const events: AgentTownEvent[] = [];
const owner = new Map<string, string>();
const copied = new Map<string, number>();
for (const evs of perSession) {
  for (const e of evs) {
    const o = owner.get(e.id);
    if (o === undefined) {
      owner.set(e.id, e.sessionId);
      events.push(e);
    } else {
      const k = `${e.sessionId.slice(0, 8)} copies ${o.slice(0, 8)}`;
      copied.set(k, (copied.get(k) ?? 0) + 1);
    }
  }
}

// ---- summary --------------------------------------------------------------------------------
const by = (f: (e: AgentTownEvent) => string | undefined) => {
  const m = new Map<string, number>();
  for (const e of events) {
    const k = f(e);
    if (k !== undefined) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
};
console.log(`parsed ${mains.length} Claude sessions and ${heads.length} Codex rollouts in ${secs.toFixed(1)} s → ${events.length} events`);
console.log("events by faction/kind:", by((e) => `${e.faction}/${e.kind}`));
console.log("spawn links:", by((e) => (e.kind === "agent_spawn" ? `${e.faction}/${e.spawnLink}` : undefined)));
console.log("agents with no task:", by((e) => (e.kind === "agent_spawn" && !e.taskId ? `${e.faction}/${e.agentType ?? "?"}` : undefined)));
console.log("tool roles:", by((e) => (e.kind === "tool_start" ? `${e.faction}/${e.role}` : undefined)));
console.log("tool status:", by((e) => (e.kind === "tool_end" ? `${e.faction}/${e.status}` : undefined)));
console.log("model calls outside any task:", by((e) => (e.kind === "model_call" && !e.taskId ? e.faction : undefined)));
console.log("records copied from an earlier session (dropped):", Object.fromEntries(copied));
console.log(`bad lines: ${stats.badLines}; unrecognised record kinds:`, Object.fromEntries(stats.unknownKinds));

const evOut = arg("--events");
if (evOut) writeFileSync(evOut, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
const totOut = arg("--totals");
if (totOut) writeFileSync(totOut, JSON.stringify(totals, null, 1));

// ---- D5 cross-check against the independent Python probes ------------------------------------
const against = arg("--against");
if (against) {
  for (const path of against.split(",")) {
    const probe = JSON.parse(readFileSync(path, "utf8")) as { faction: "claude" | "codex"; totals: Record<string, number[]> };
    const probeTime = statSync(path).mtimeMs;
    const mine = totals[probe.faction];
    let same = 0;
    const diff: string[] = [];
    const live: string[] = [];
    for (const [k, v] of Object.entries(probe.totals)) {
      const m = mine[k];
      if (m && m.every((x, i) => x === v[i])) same++;
      else if ((modified[probe.faction][k] ?? 0) > probeTime - 60_000) live.push(k);
      else diff.push(`${k}: probe ${JSON.stringify(v)} adapter ${JSON.stringify(m)}`);
    }
    const extra = Object.keys(mine).filter((k) => !(k in probe.totals) && (modified[probe.faction][k] ?? 0) <= probeTime);
    console.log(`D5 ${probe.faction}: ${same}/${Object.keys(probe.totals).length} identical, ${diff.length} differ, ` +
      `${live.length} written to while checking (not compared), ${extra.length} only in adapter`);
    if (live.length) console.log("    written to while checking:", live.map((k) => k.slice(0, 12)).join(", "));
    for (const d of diff.slice(0, 5)) console.log("   ", d);
    if (diff.length || extra.length) problems.push(`D5 ${probe.faction} totals differ from the probe`);
  }
}

if (problems.length) {
  console.error("FAIL:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("OK");
