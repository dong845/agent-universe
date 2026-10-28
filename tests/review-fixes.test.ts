// Final-review findings (2026-10-28): each test reproduces one, and fails without its fix.
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { assignProjects } from "../packages/server/src/assign.ts";
import { parsePort, staticDirFrom } from "../packages/server/src/cli.ts";
import { createServer } from "../packages/server/src/http.ts";
import { loadEvents, loadEventsAsync } from "../packages/server/src/load.ts";
import { openSessions, openTasks } from "../packages/web/src/ui/counts.ts";
import { taskOfSelection } from "../packages/web/src/ui/diaryModel.ts";
import { useStore } from "../packages/web/src/store.ts";
import { writeClaudeSession } from "./helpers/synthLogs.ts";

const tk = { input: 1, output: 1, cacheRead: 1, cacheWrite: 0 };
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "at-rev-")));

// ---- S1, S2: the server -----------------------------------------------------------------------
describe("server hardening", () => {
  const root = tmp();
  writeClaudeSession(join(root, "claude"), { sessionId: "r1", cwd: join(root, "p"), t0: 1e12, turns: [{ prompt: "x", tokens: tk }] });
  let srv: ReturnType<typeof createServer>;
  let port = 0;
  const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    new Promise<number>((res, rej) => {
      const r = http.request({ host: "127.0.0.1", port, path, method, headers }, (x) => { x.resume(); res(x.statusCode!); });
      r.on("error", rej);
      r.end();
    });
  beforeAll(async () => {
    srv = createServer({ load: (p) => loadEventsAsync({ claudeRoot: join(root, "claude"), codexRoot: join(root, "none"), cacheDir: null, onProgress: p, assign: { home: root, tempRoots: [] } }), staticDir: null });
    await new Promise<void>((r) => srv.server.listen(0, "127.0.0.1", r));
    port = (srv.server.address() as AddressInfo).port;
    for (let i = 0; i < 100 && srv.state().phase !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
  });
  afterAll(() => srv.server.close());

  it("S1: a malformed task id is a 400, and the server keeps serving", async () => {
    expect(await req("/api/task/%E0%A4%A")).toBe(400);
    expect(await req("/api/status")).toBe(200);
  });

  it("S2: refuses a foreign Host (DNS rebinding) and a cross-site POST", async () => {
    expect(await req("/api/world", { Host: `attacker.example:${port}` })).toBe(403);
    expect(await req("/api/world", { Host: `localhost:${port}` })).toBe(200);
    expect(await req("/api/refresh", { Origin: "https://evil.example" }, "POST")).toBe(403);
    expect(await req("/api/refresh", { Origin: `http://127.0.0.1:${port}` }, "POST")).toBe(202);
  });
});

// ---- C1: cache keyed on the code and config that produced it --------------------------------------
describe("cache invalidation", () => {
  it("C1: editing roles.json re-reads every session", () => {
    const root = tmp();
    writeClaudeSession(join(root, "claude"), { sessionId: "c1", cwd: join(root, "p"), t0: 1e12, turns: [{ prompt: "x", tokens: tk }] });
    const roles = join(root, "roles.json");
    copyFileSync(new URL("../config/roles.json", import.meta.url), roles);
    const o = { claudeRoot: join(root, "claude"), codexRoot: join(root, "none"), cacheDir: join(root, "cache"), rolesPath: roles, assign: { home: root, tempRoots: [] } };
    expect(loadEvents(o).parsed).toBe(1);
    expect(loadEvents(o).cached).toBe(1);
    writeFileSync(roles, require("node:fs").readFileSync(roles, "utf8") + "\n");
    expect(loadEvents(o).parsed).toBe(1);
  });
});

// ---- M3: damaged side files never fail the whole load ---------------------------------------------
describe("damaged side files", () => {
  it("M3: a half-written subagent meta file is counted, not fatal", () => {
    const root = tmp();
    const main = writeClaudeSession(join(root, "claude"), { sessionId: "m3", cwd: join(root, "p"), t0: 1e12, turns: [{ prompt: "x", tokens: tk }] });
    const sub = join(main.slice(0, -".jsonl".length), "subagents");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "agent-a1.jsonl"), "");
    writeFileSync(join(sub, "agent-a1.meta.json"), '{"agentType": "Expl');
    const r = loadEvents({ claudeRoot: join(root, "claude"), codexRoot: join(root, "none"), cacheDir: null, assign: { home: root, tempRoots: [] } });
    expect(r.events.some((e) => e.kind === "task_start")).toBe(true);
    expect(r.stats.badLines).toBeGreaterThanOrEqual(1);
  });
});

// ---- A1, A2: town assignment ------------------------------------------------------------------------
describe("assignment edge cases", () => {
  let n = 0;
  const ev = (p: Partial<AgentTownEvent>): AgentTownEvent => ({ id: `e${n++}`, ts: n, faction: "claude-code", projectId: "/x", sessionId: "s", taskId: "t", agentId: "main", kind: "tool_start", raw: { file: "f", line: 1 }, ...p });

  it("A1: a deleted repo stays one town: files under the task's cwd go to the cwd", () => {
    const h = tmp();
    const cwd = join(h, "oldrepo"); // never created: the repo is gone
    const evs = ["src/a.ts", "tests/b.ts", "README.md"].flatMap((f, i) => [
      ev({ kind: "task_start", projectId: cwd, taskId: `t${i}` }),
      ev({ tool: "Edit", target: join(cwd, f), projectId: cwd, taskId: `t${i}` }),
    ]);
    assignProjects(evs, { home: h, tempRoots: [] });
    expect(new Set(evs.map((e) => e.projectId))).toEqual(new Set([cwd]));
  });

  it("A2: a non-absolute cwd is never resolved against the server's own directory", () => {
    const h = tmp();
    const evs = [ev({ kind: "task_start", projectId: "unknown", faction: "codex" }), ev({ tool: "apply_patch", target: "*** Update File: src/z.ts", projectId: "unknown", faction: "codex" })];
    assignProjects(evs, { home: h, tempRoots: [] });
    for (const e of evs) expect(e.projectId).toBe("unknown");
  });
});

// ---- R1: replay survives clicking its own figures --------------------------------------------------
describe("replay and selection", () => {
  it("R1: selecting a figure in the replayed town keeps the replay, and the diary stays on the task", () => {
    const p = demoPayload();
    useStore.getState().load(p);
    const district = "claude-code|/demo/web-shop";
    const task = p.events.filter((e) => e.taskId === "demo:task:0");
    useStore.getState().startReplay(district, task);
    useStore.getState().select({ kind: "agent", district, agentId: "agent-scout" });
    expect(useStore.getState().replay?.taskId).toBe("demo:task:0");
    const s = useStore.getState();
    expect(taskOfSelection(s.selected, s.events, new Set(), s.replay)).toBe("demo:task:0");
    useStore.getState().select({ kind: "task", district: "codex|/demo/web-shop", taskId: "other" });
    expect(useStore.getState().replay).toBeNull();
  });
});

// ---- U1: unended tasks are never "in progress" --------------------------------------------------------
describe("open counts", () => {
  const base = { faction: "codex" as const, projectId: "/p", agentId: "main", raw: { file: "f", line: 1 } };
  const evs: AgentTownEvent[] = [
    { ...base, id: "1", sessionId: "A", taskId: "dead", ts: 1, kind: "task_start" },
    { ...base, id: "2", sessionId: "B", taskId: "live", ts: 2, kind: "task_start" },
  ];
  it("U1: a task that stopped without an end counts neither as an open task nor an active session", () => {
    expect(openTasks(evs, 10, new Set(["dead"]))).toBe(1);
    expect(openSessions(evs, 10, () => true, new Set(["dead"]))).toBe(1);
  });
});

// ---- M1: CLI parsing -------------------------------------------------------------------------------------
describe("serve.ts arguments", () => {
  it("M1: finds the web build under a path with spaces or Chinese", () => {
    expect(staticDirFrom(new URL("file:///Users/x/%E9%A1%B9%E7%9B%AE%20a/agent-town/scripts/serve.ts"))).toBe("/Users/x/项目 a/agent-town/packages/web/dist");
  });
  it("M1: rejects a port that is not a number with a clear message", () => {
    expect(parsePort(undefined)).toBe(5182);
    expect(parsePort("6000")).toBe(6000);
    expect(() => parsePort("abc")).toThrow("--port 需要 1–65535 之间的数字，收到 abc");
  });
});
