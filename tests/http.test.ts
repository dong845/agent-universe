import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
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
    expect(s).toMatchObject({ phase: "ready", done: 2, total: 2 });
  });

  it("serves the compact world", async () => {
    const r = await fetch(`${base}/api/world`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const p = await r.json();
    expect(p.source).toBe("real");
    expect(p.events.filter((e: { kind: string }) => e.kind === "task_start")).toHaveLength(2);
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
