// Minimal phase-0 parser: local logs → unified events, plus the D5 cross-check against the probes.
//
//   node scripts/parse.ts [--claude <root>] [--codex <root>] [--events out.jsonl]
//                         [--totals out.json] [--against probe-claude.json,probe-codex.json]
//
// Without roots it reads ~/.claude/projects and ~/.codex/sessions. It prints only counts.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEvents } from "../packages/server/src/load.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const claudeRoot = arg("--claude") ?? join(homedir(), ".claude/projects");
const codexRoot = arg("--codex") ?? join(homedir(), ".codex/sessions");
const t0 = Date.now();
// --cache <dir> reuses parsed units; without it every file is read fresh (the D5 check's default)
const { events, perUnit, totals, modified, stats, copied, units } = loadEvents({ claudeRoot, codexRoot, cacheDir: arg("--cache") ?? null });
const secs = (Date.now() - t0) / 1000;

// ---- fail-loud invariants ----------------------------------------------------------------
const problems: string[] = [];
for (const evs of perUnit) {
  const ids = new Set<string>();
  for (const e of evs) {
    if (!Number.isFinite(e.ts)) problems.push(`event without timestamp: ${e.kind} ${e.raw.file}:${e.raw.line}`);
    if (e.tokens && Object.values(e.tokens).some((v) => v < 0)) problems.push(`negative tokens: ${e.raw.file}:${e.raw.line}`);
    if (ids.has(e.id)) problems.push(`duplicated id inside one session: ${e.kind} ${e.raw.file}:${e.raw.line}`);
    ids.add(e.id);
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
console.log(`parsed ${units.claude} Claude sessions and ${units.codexRollouts} Codex rollouts in ${secs.toFixed(1)} s → ${events.length} events`);
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
