// Final-review findings on the live/history/release branch (2026-11-04): each test reproduces one.
import { appendFileSync, existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexThreadParser, type RolloutHead } from "../packages/adapter-codex/src/index.ts";
import { demoPayload } from "../packages/mock/src/world.ts";
import { loadRoles } from "../packages/schema/src/roles.ts";
import { newStats, readJsonlFrom } from "../packages/schema/src/util.ts";
import { loadEvents } from "../packages/server/src/load.ts";
import { latestApplier } from "../packages/web/src/throttle.ts";
import { useStore } from "../packages/web/src/store.ts";
import { installCommand, openBrowser } from "../scripts/start.mjs";
import { writeClaudeSession } from "./helpers/synthLogs.ts";

const tk = { input: 1, output: 1, cacheRead: 1, cacheWrite: 0 };

describe("I1 memory: kept parsers only for recently written sessions; reads in chunks", () => {
  it("a session last written long ago keeps no parser", () => {
    const root = mkdtempSync(join(tmpdir(), "at-rv-"));
    const p = writeClaudeSession(join(root, "claude"), { sessionId: "old1", cwd: "/synthetic/o", t0: 1e12, turns: [{ prompt: "x", tokens: tk }] });
    const live = new Map();
    const o = { claudeRoot: join(root, "claude"), codexRoot: join(root, "none"), cacheDir: null, memo: new Map(), live, assign: { home: root, tempRoots: [] } };
    const old = Date.now() / 1000 - 3 * 3600;
    utimesSync(p, old, old);
    loadEvents(o);
    expect(live.size).toBe(0);
    appendFileSync(p, "\n");
    loadEvents(o);
    expect(live.size).toBe(1);
  });
  it("chunked reading gives the same lines", () => {
    const d = mkdtempSync(join(tmpdir(), "at-rv-"));
    const f = join(d, "a.jsonl");
    writeFileSync(f, ['{"a":"中文字"}', "", '{"b":2}', '{"c":"x'].join("\n"));
    const whole = readJsonlFrom(f, 0, 0, newStats());
    const small = readJsonlFrom(f, 0, 0, newStats(), 5);
    expect(small).toEqual(whole);
    expect(whole.lines.map((l) => l.n)).toEqual([1, 3]);
  });
});

describe("I2 a last line without its newline", () => {
  it("is reported as pending, and the unit's disk cache is not written from it", () => {
    const root = mkdtempSync(join(tmpdir(), "at-rv-"));
    const p = writeClaudeSession(join(root, "claude"), { sessionId: "nl1", cwd: "/synthetic/n", t0: 1e12, turns: [{ prompt: "x", tokens: tk }] });
    appendFileSync(p, JSON.stringify({ type: "system", subtype: "turn_duration", timestamp: new Date(1e12 + 99_000).toISOString(), uuid: "z" }));
    const f = readJsonlFrom(p, 0, 0, newStats());
    expect(f.pending).toBe(true);
    const cacheDir = join(root, "cache");
    loadEvents({ claudeRoot: join(root, "claude"), codexRoot: join(root, "none"), cacheDir, memo: new Map(), live: new Map(), assign: { home: root, tempRoots: [] } });
    expect(existsSync(cacheDir) ? readdirSync(cacheDir).length : 0).toBe(0);
  });
});

describe("I3 Codex: an inferred spawn link does not depend on how the files were read", () => {
  const roles = loadRoles();
  const at = (s: number) => new Date(Date.UTC(2026, 10, 4) + s * 1000).toISOString();
  const line = (n: number, s: number, type: string, payload: object) => ({ n, rec: { type, timestamp: at(s), payload } });
  const spawn = (n: number, s: number, id: string) => line(n, s, "response_item", { type: "function_call", name: "spawn_agent", arguments: "{}", call_id: id });
  const root: RolloutHead = { path: "/r.jsonl", id: "root", cwd: "/synthetic", firstTs: Date.parse(at(0)) };
  const childA: RolloutHead = { path: "/a.jsonl", id: "a", parentId: "root", cwd: "/synthetic", agentType: "worker", firstTs: Date.parse(at(11)) };
  const late: RolloutHead = { path: "/z.jsonl", id: "z", parentId: "root", cwd: "/synthetic", agentType: "worker", firstTs: Date.parse(at(25)) };
  const rootLines = [line(1, 0, "session_meta", { id: "root" }), line(2, 1, "event_msg", { type: "task_started", turn_id: "t1" }), spawn(3, 10, "cA"), spawn(4, 15, "cC")];
  const aLines = [line(1, 11, "session_meta", { id: "a" }), spawn(2, 20, "cB")];
  const zLines = [line(1, 25, "session_meta", { id: "z" })];
  const pick = (p: CodexThreadParser) => p.finish().events.find((e) => e.kind === "agent_spawn" && e.agentId === "z")!;
  it("full and split reads give the same parent", () => {
    const full = new CodexThreadParser(root, roles, newStats());
    full.feed(root, rootLines);
    full.feed(childA, aLines);
    full.feed(late, zLines);
    const split = new CodexThreadParser(root, roles, newStats());
    split.feed(root, rootLines.slice(0, 3));
    split.feed(childA, aLines);
    split.feed(root, rootLines.slice(3));
    split.feed(late, zLines);
    expect(pick(split)).toEqual(pick(full));
    expect(pick(full).spawnToolUseId).toBe("cB"); // the latest spawn before it started, by time
  });
});

describe("I4 a replay while live", () => {
  it("leaves live, so the replay keeps its own speed", () => {
    const p = { ...demoPayload(), source: "real" as const };
    useStore.getState().load(p);
    expect(useStore.getState().following).toBe(true);
    const r = p.requests.find((x) => x.calls > 2)!;
    const evs = p.events.filter((e) => e.taskId && r.taskIds.includes(e.taskId));
    const district = `${evs[0].faction}|${evs[0].projectId}`;
    try {
      useStore.getState().startReplay(district, evs);
    } catch {
      // a district this world has no runtime for: the replay itself is not what is tested here
    }
    expect(useStore.getState().following).toBe(false);
  });
});

describe("I5 a hidden tab", () => {
  it("only the newest pending world is prepared when frames come back", async () => {
    let release: () => void = () => {};
    const frame = () => new Promise<void>((res) => { release = res; });
    const prepared: number[] = [];
    const apply = latestApplier<number>(async (v, f) => { await f(); prepared.push(v); }, frame);
    apply(1);
    apply(2);
    apply(3);
    apply(4);
    release();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(prepared).toEqual([1, 4]);
  });
});

describe("I6/I7 launcher on other systems", () => {
  it("Windows runs corepack through the shell", () => {
    expect(installCommand("win32")).toMatchObject({ shell: true });
    expect(installCommand("darwin")).toMatchObject({ cmd: "corepack", shell: false });
  });
  it("a missing browser opener does not crash the launcher", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    openBrowser("http://127.0.0.1:1/", "definitely-not-a-command-xyz");
    await new Promise((r) => setTimeout(r, 300));
    expect(log.mock.calls.flat().join(" ")).toContain("http://127.0.0.1:1/");
    log.mockRestore();
  });
});

describe("share mode switched on while a newer world was being prepared", () => {
  it("the world applied is masked, and the real one is kept", () => {
    const p = demoPayload();
    useStore.getState().load(p);
    useStore.getState().setShare(false);
    const prepared = useStore.getState().prepare(p);
    const names = Object.fromEntries(p.towns.map((t) => [t.key, `Code-${t.key.length}`]));
    useStore.getState().setShare(true, names);
    useStore.getState().reload(p, prepared);
    const s = useStore.getState();
    expect([...s.w25!.towns.values()].every((t) => t.name.startsWith("Code-"))).toBe(true);
    expect(s.realW25).not.toBeNull();
    useStore.getState().setShare(false);
    expect(useStore.getState().w25).not.toBeNull();
  });
});
