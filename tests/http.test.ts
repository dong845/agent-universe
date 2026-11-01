import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, portInUseMessage } from "../packages/server/src/http.ts";
import { loadEventsAsync } from "../packages/server/src/load.ts";
import { writeClaudeSession, writeCodexRollout } from "./helpers/synthLogs.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "at-http-")));
const tk = { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 };
writeClaudeSession(join(root, "claude"), { sessionId: "h1", cwd: join(root, "proj"), t0: 1e12, turns: [{ prompt: "第一个任务", tools: [{ name: "Read", input: { file_path: join(root, "proj/a.ts") } }], tokens: tk }] });
writeCodexRollout(join(root, "codex"), { sessionId: "h2", cwd: join(root, "proj"), t0: 1e12 + 5000, turns: [{ prompt: "second", tokens: tk }] });
writeClaudeSession(join(root, "claude"), { sessionId: "h3", cwd: join(root, "proj"), t0: 1e12 + 9000, turns: [{ prompt: "请求", tokens: tk }, { prompt: "subagent result", opener: "peer", tokens: tk }] });
const themesFile = join(root, "agent-town", "themes.json");
const web = join(root, "dist");
mkdirSync(web);
writeFileSync(join(web, "index.html"), "<!doctype html><title>t</title>");
writeFileSync(join(root, "secret.txt"), "no");

let base = "";
let srv: ReturnType<typeof createServer>;
beforeAll(async () => {
  srv = createServer({
    load: (onProgress) => loadEventsAsync({ claudeRoot: join(root, "claude"), codexRoot: join(root, "codex"), cacheDir: null, onProgress, assign: { home: root, tempRoots: [] } }),
    staticDir: web,
    themesFile,
  });
  await new Promise<void>((r) => srv.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  for (let i = 0; i < 100 && srv.state().phase !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
});
afterAll(() => srv.server.close());

describe("local server", () => {
  it("listens on the loopback interface only", () => {
    expect((srv.server.address() as AddressInfo).address).toBe("127.0.0.1");
  });

  it("reports loading progress, then ready", async () => {
    const s = await (await fetch(`${base}/api/status`)).json();
    expect(s).toMatchObject({ phase: "ready", done: 3, total: 3 });
  });

  it("serves the compact world", async () => {
    const r = await fetch(`${base}/api/world`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const p = await r.json();
    expect(p.source).toBe("real");
    expect(p.events.filter((e: { kind: string }) => e.kind === "task_start")).toHaveLength(4);
  });

  it("serves one task's full events, and 404 for an unknown task", async () => {
    const p = await (await fetch(`${base}/api/world`)).json();
    const id = p.events.find((e: { kind: string; title?: string }) => e.kind === "task_start" && e.title === "第一个任务").taskId;
    const t = await (await fetch(`${base}/api/task/${encodeURIComponent(id)}`)).json();
    expect(t.events.length).toBeGreaterThan(3);
    expect(t.events.every((e: { taskId: string }) => e.taskId === id)).toBe(true);
    expect(t.events.some((e: { kind: string }) => e.kind === "tool_start")).toBe(true);
    expect((await fetch(`${base}/api/task/nope`)).status).toBe(404);
  });

  it("serves the built page, and nothing outside it", async () => {
    expect(await (await fetch(`${base}/`)).text()).toContain("<title>t</title>");
    expect(await (await fetch(`${base}/some/route`)).text()).toContain("<title>t</title>");
    const r = await fetch(`${base}/..%2fsecret.txt`);
    expect(r.status).toBe(403);
  });

  it("reloads on request", async () => {
    const r = await fetch(`${base}/api/refresh`, { method: "POST" });
    expect(r.status).toBe(202);
  });

  it("names the port when it is taken", () => {
    expect(portInUseMessage(5182)).toBe("端口 5182 已被占用：可能已经有一个 Agent Town 在运行");
  });
});

describe("local server, v3 routes", () => {
  const world = async () => (await fetch(`${base}/api/world`)).json();
  // an earlier test asks for /api/refresh: wait until the reload is done
  beforeAll(async () => {
    for (let i = 0; i < 200 && srv.state().phase !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
  });

  it("serves requests and towns with the world", async () => {
    const w = await world();
    expect(w.requests.length).toBe(3);
    expect(w.towns.length).toBeGreaterThan(0);
  });

  it("serves all turns of one request, 404 for an unknown one, 400 for a bad id", async () => {
    const w = await world();
    const r = w.requests.find((x: { turns: number }) => x.turns === 2);
    const res = await fetch(`${base}/api/request/${encodeURIComponent(r.requestId)}`);
    const body = await res.json();
    expect(new Set(body.events.map((e: { taskId: string }) => e.taskId)).size).toBe(2);
    expect((await fetch(`${base}/api/request/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/request/%E0%A4%A`)).status).toBe(400);
  });

  it("saves a theme choice locally and shows it in the next world", async () => {
    const key = (await world()).towns[0].key;
    const res = await fetch(`${base}/api/theme`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, theme: "harbor" }) });
    expect(res.status).toBe(204);
    expect((await world()).towns.find((t: { key: string }) => t.key === key).theme).toBe("harbor");
    expect(JSON.parse(readFileSync(themesFile, "utf8"))[key]).toBe("harbor");
  });

  it("refuses an unknown theme or town, and a foreign page", async () => {
    const key = (await world()).towns[0].key;
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/theme`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await post({ key, theme: "nope" })).status).toBe(400);
    expect((await post({ key: "codex|/nowhere", theme: "film" })).status).toBe(400);
    expect((await post({ key, theme: "capital" })).status).toBe(400);
    expect((await post({ key, theme: "film" }, { origin: "http://evil.example" })).status).toBe(403);
  });
});

describe("attention: stream, hook endpoint", () => {
  const now = Date.now();
  const mk = (kind: string, ago: number, extra: Record<string, unknown> = {}) => ({ id: `${kind}-${ago}`, ts: now - ago, faction: "claude-code", projectId: "/synthetic/p", sessionId: "live1", taskId: "live1-t", agentId: "main", kind, raw: { file: "/synthetic/live1.jsonl", line: 1 }, ...extra });
  const events = [mk("task_start", 40_000, { trigger: "human", title: "x", permissionMode: "default" }), mk("tool_start", 25_000, { tool: "Bash", toolUseId: "b1", target: "make" })];
  let changed: (() => void) | null = null;
  let s: ReturnType<typeof createServer>;
  let b = "";
  beforeAll(async () => {
    s = createServer({
      load: async () => ({ events, requestOf: new Map([["live1-t", "live1-t"]]), mtimes: new Map() }) as never,
      staticDir: null,
      themesFile: join(root, "agent-town", "themes2.json"),
      watch: (cb) => { changed = cb; return () => {}; },
      reloadGapMs: 0,
      settingsFile: join(root, "agent-town", "settings-test.json"),
      shareSecretFile: join(root, "agent-town", "share-secret"),
      hookFiles: { claude: join(root, "agent-town", "claude-settings.json"), codex: join(root, "agent-town", "codex-hooks.json") },
    });
    await new Promise<void>((r) => s.server.listen(0, "127.0.0.1", r));
    b = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
    for (let i = 0; i < 100 && s.state().phase !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
  });
  afterAll(() => s.server.close());

  it("stream sends world after a watched reload", async () => {
    const ctl = new AbortController();
    const r = await fetch(`${b}/api/stream`, { signal: ctl.signal });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const reader = r.body!.getReader();
    changed!();
    let text = "";
    const dec = new TextDecoder();
    for (let i = 0; i < 20 && !text.includes("event: world"); i++) text += dec.decode((await reader.read()).value);
    ctl.abort();
    expect(text).toContain("event: world");
    expect(text).toContain("event: attention");
  });

  it("hook flips maybe-waiting to waiting", async () => {
    const a0 = await (await fetch(`${b}/api/attention`)).json();
    expect(a0.map((x: { state: string }) => x.state)).toEqual(["maybe-waiting"]);
    const r = await fetch(`${b}/api/hook?src=claude`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: "live1", hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }) });
    expect(r.status).toBe(204);
    const a1 = await (await fetch(`${b}/api/attention`)).json();
    expect(a1[0]).toMatchObject({ state: "waiting", exact: true });
  });

  it("settings: defaults, then a switch saved", async () => {
    expect(await (await fetch(`${b}/api/settings`)).json()).toMatchObject({ notify: true, notifyTurnDone: false });
    const r = await fetch(`${b}/api/settings`, { method: "POST", body: JSON.stringify({ notifyTurnDone: true, hooks: { claude: true } }) });
    expect(r.status).toBe(200);
    const s2 = await (await fetch(`${b}/api/settings`)).json();
    expect(s2.notifyTurnDone).toBe(true);
    expect(s2.hooks.claude).toBe(false); // hooks change only through /api/hooks
  });

  it("names a town for a notification", () => {
    expect(s.townName("/synthetic/p", "claude-code")).toBeTruthy();
  });

  it("the hook switch installs, reports, and removes", async () => {
    const on = await (await fetch(`${b}/api/hooks`, { method: "POST", body: JSON.stringify({ agent: "claude", on: true }) })).json();
    expect(on).toMatchObject({ on: true, added: ["Notification", "Stop"] });
    expect(readFileSync(join(root, "agent-town", "claude-settings.json"), "utf8")).toContain("agent-town-hook");
    expect((await (await fetch(`${b}/api/settings`)).json()).hooks).toEqual({ claude: true, codex: false });
    const off = await (await fetch(`${b}/api/hooks`, { method: "POST", body: JSON.stringify({ agent: "claude", on: false }) })).json();
    expect(off).toMatchObject({ on: false, removed: 2 });
    expect((await (await fetch(`${b}/api/settings`)).json()).hooks.claude).toBe(false);
    expect((await fetch(`${b}/api/hooks`, { method: "POST", body: JSON.stringify({ agent: "other", on: true }) })).status).toBe(400);
  });

  it("code names for share mode: one per town, stable, never the folder", async () => {
    const a = await (await fetch(`${b}/api/share/names`)).json();
    const b2 = await (await fetch(`${b}/api/share/names`)).json();
    expect(Object.keys(a).length).toBeGreaterThan(0);
    expect(a).toEqual(b2);
    expect(Object.values(a).join(" ")).not.toContain("synthetic");
    expect(readFileSync(join(root, "agent-town", "share-secret"), "utf8").trim().length).toBeGreaterThanOrEqual(32);
  });

  it("hook refused from a foreign origin", async () => {
    const r = await fetch(`${b}/api/hook?src=claude`, { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });

  it("hook with bad JSON or unknown source is refused", async () => {
    expect((await fetch(`${b}/api/hook?src=claude`, { method: "POST", body: "not json" })).status).toBe(400);
    expect((await fetch(`${b}/api/hook?src=other`, { method: "POST", body: "{}" })).status).toBe(400);
  });
});

describe("share page export route", () => {
  let s: ReturnType<typeof createServer>;
  let b = "";
  const dist = join(root, "dist-share");
  beforeAll(async () => {
    mkdirSync(join(dist, "assets"), { recursive: true });
    mkdirSync(join(dist, "models"), { recursive: true });
    writeFileSync(join(dist, "index.html"), '<!doctype html><html><head><script type="module" crossorigin src="/assets/i.js"></script></head><body><div id="root"></div></body></html>');
    writeFileSync(join(dist, "assets", "i.js"), "1");
    writeFileSync(join(dist, "models", "city.glb"), "c");
    writeFileSync(join(dist, "models", "robot.glb"), "r");
    s = createServer({
      load: (onProgress) => loadEventsAsync({ claudeRoot: join(root, "claude"), codexRoot: join(root, "codex"), cacheDir: null, onProgress, assign: { home: root, tempRoots: [] } }),
      staticDir: dist,
      themesFile,
      shareSecretFile: join(root, "agent-town", "share-secret-2"),
      shareMaxBytes: 1_000_000,
    });
    await new Promise<void>((r) => s.server.listen(0, "127.0.0.1", r));
    b = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
    for (let i = 0; i < 100 && s.state().phase !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
  });
  afterAll(() => s.server.close());

  it("exports one HTML file with names hidden by default", async () => {
    const r = await fetch(`${b}/api/export/share`, { method: "POST", body: JSON.stringify({ realNames: false, replays: [] }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="agent-town-share-\d{4}-\d{2}-\d{2}\.html"/);
    const html = await r.text();
    expect(html).toContain('id="agent-town-share"');
    expect(html).not.toContain("第一个任务");
    expect(html).not.toContain(root);
  });
  it("includes up to 5 replays, and refuses more", async () => {
    const w = await (await fetch(`${b}/api/world`)).json();
    const rid = w.requests[0].requestId;
    const ok = await fetch(`${b}/api/export/share`, { method: "POST", body: JSON.stringify({ realNames: false, replays: [rid] }) });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('"shareReplays":[{"requestId"');
    const many = await fetch(`${b}/api/export/share`, { method: "POST", body: JSON.stringify({ realNames: false, replays: ["a", "b", "c", "d", "e", "f"] }) });
    expect(many.status).toBe(400);
  });
  it("answers 413 above the size limit, naming the largest part", async () => {
    writeFileSync(join(dist, "models", "city.glb"), Buffer.alloc(1_200_000, 1));
    const r = await fetch(`${b}/api/export/share`, { method: "POST", body: JSON.stringify({ realNames: false, replays: [] }) });
    expect(r.status).toBe(413);
    expect((await r.json()).error).toContain("city");
  });
});

describe("a failed reload keeps the last good world (review I1)", () => {
  it("still serves the world and stays ready", async () => {
    let n = 0;
    const s2 = createServer({
      load: async (onProgress) => {
        if (n++ > 0) throw new Error("session file vanished mid-read");
        return loadEventsAsync({ claudeRoot: join(root, "claude"), codexRoot: join(root, "codex"), cacheDir: null, onProgress, assign: { home: root, tempRoots: [] } });
      },
      staticDir: null,
      themesFile,
    });
    await new Promise<void>((r) => s2.server.listen(0, "127.0.0.1", r));
    const base2 = `http://127.0.0.1:${(s2.server.address() as AddressInfo).port}`;
    for (let i = 0; i < 100 && s2.state().phase !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
    await s2.reload();
    expect(s2.state().phase).toBe("ready");
    expect((await fetch(`${base2}/api/world`)).status).toBe(200);
    s2.server.close();
  });
});
