import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEvents } from "../packages/server/src/load.ts";
import { writeClaudeSession, writeCodexRollout, type SynthSession } from "./helpers/synthLogs.ts";

const tk = (input: number, output: number, cacheRead: number, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });
const T0 = Date.UTC(2026, 9, 1);

function corpus() {
  const root = mkdtempSync(join(tmpdir(), "at-load-"));
  const claudeRoot = join(root, "claude");
  const codexRoot = join(root, "codex");
  const s = (id: string, cwd: string, k: number): SynthSession => ({
    sessionId: id, cwd, t0: T0 + k * 3_600_000,
    turns: [{ prompt: `task ${id}`, tools: [{ name: "Read", input: { file_path: `${cwd}/a.ts` } }], tokens: tk(1, 2, 3) }],
  });
  const paths = {
    c1: writeClaudeSession(claudeRoot, s("c1", "/synth/one", 0)),
    c2: writeClaudeSession(claudeRoot, s("c2", "/synth/two", 1)),
    x1: writeCodexRollout(codexRoot, { ...s("x1", "/synth/one", 2), turns: [{ prompt: "x1", tools: [{ name: "exec_command", input: { cmd: "ls" } }], tokens: tk(1, 2, 3) }] }),
    x2: writeCodexRollout(codexRoot, { ...s("x2", "/synth/three", 3), turns: [{ prompt: "x2", tokens: tk(4, 5, 6) }] }),
  };
  return { root, claudeRoot, codexRoot, cacheDir: join(root, "cache"), paths };
}

describe("loadEvents", () => {
  it("reads every unit once, then serves an unchanged corpus from the cache", () => {
    const c = corpus();
    const a = loadEvents(c);
    expect(a.parsed).toBe(4);
    expect(a.cached).toBe(0);
    const b = loadEvents(c);
    expect(b.parsed).toBe(0);
    expect(b.cached).toBe(4);
    expect(b.events).toEqual(a.events);
    expect(b.totals).toEqual(a.totals);
  });

  it("with a memo, a reload reads no cache files and leaves earlier results untouched", () => {
    const c = corpus();
    const memo = new Map();
    const a = loadEvents({ ...c, memo });
    const projects = a.events.map((e) => e.projectId);
    rmSync(c.cacheDir, { recursive: true });
    const b = loadEvents({ ...c, memo });
    expect(b.parsed).toBe(0);
    expect(b.cached).toBe(4);
    expect(b.events.map((e) => e.projectId)).toEqual(projects);
    // project assignment rewrote b's events, not the memo's
    expect(b.events[0]).not.toBe(a.events[0]);
    writeClaudeSession(c.claudeRoot, { sessionId: "c9", cwd: "/synth/nine", t0: T0, turns: [{ prompt: "n", tokens: tk(1, 1, 1) }] });
    const d = loadEvents({ ...c, memo });
    expect(d.parsed).toBe(1);
    expect(memo.size).toBe(5);
  });

  it("re-reads only the unit whose file changed", () => {
    const c = corpus();
    loadEvents(c);
    writeClaudeSession(c.claudeRoot, { sessionId: "c1", cwd: "/synth/one", t0: T0, turns: [{ prompt: "a", tokens: tk(1, 1, 1) }, { prompt: "b", tokens: tk(2, 2, 2) }] });
    const b = loadEvents(c);
    expect(b.parsed).toBe(1);
    expect(b.cached).toBe(3);
    expect(b.events.filter((e) => e.sessionId === "c1" && e.kind === "task_start")).toHaveLength(2);
  });

  it("survives a file cut off mid-line: earlier events kept, one bad line counted", () => {
    const c = corpus();
    appendFileSync(c.paths.c2, '{"type":"user","message":{"content":"half');
    const r = loadEvents({ ...c, cacheDir: null });
    expect(r.stats.badLines).toBe(1);
    expect(r.events.some((e) => e.sessionId === "c2" && e.kind === "task_start")).toBe(true);
  });

  it("works with a missing Codex root", () => {
    const c = corpus();
    const r = loadEvents({ ...c, codexRoot: join(c.root, "nope"), cacheDir: null });
    expect(new Set(r.events.map((e) => e.faction))).toEqual(new Set(["claude-code"]));
  });

  it("writes nothing without a cache dir, and reports progress to the end", () => {
    const c = corpus();
    const seen: [number, number][] = [];
    loadEvents({ ...c, cacheDir: null, onProgress: (d, t) => seen.push([d, t]) });
    expect(existsSync(c.cacheDir)).toBe(false);
    expect(seen.at(-1)).toEqual([4, 4]);
  });

  it("returns events sorted by time and the mtime of every source file", () => {
    const c = corpus();
    const r = loadEvents({ ...c, cacheDir: null });
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].ts).toBeGreaterThanOrEqual(r.events[i - 1].ts);
    for (const e of r.events) expect(r.mtimes.has(e.raw.file)).toBe(true);
    expect(readdirSync(c.root)).not.toContain("cache");
  });
});
