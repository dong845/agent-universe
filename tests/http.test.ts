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
