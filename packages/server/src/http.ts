// The local server (spec 3): loopback only, no dependencies. It loads the logs once at start (and on
// /api/refresh), keeps every event in memory, and serves the compact world, one task's full events
// on demand, and the built page.
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize, sep } from "node:path";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import type { Loaded } from "./load.ts";
import { compactPayload, type WorldPayload } from "./payload.ts";

export interface ServerState {
  phase: "loading" | "ready" | "error";
  done: number;
  total: number;
  error?: string;
}

export interface ServerOptions {
  load: (onProgress: (done: number, total: number) => void) => Promise<Loaded>;
  /** the built web app; null serves the API only */
  staticDir: string | null;
  now?: () => number;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

export function portInUseMessage(port: number): string {
  return `端口 ${port} 已被占用：可能已经有一个 Agent Town 在运行`;
}

export function createServer(o: ServerOptions) {
  const now = o.now ?? Date.now;
  const state: ServerState = { phase: "loading", done: 0, total: 0 };
  let payload: WorldPayload | null = null;
  let byTask = new Map<string, AgentTownEvent[]>();
  let loading: Promise<void> | null = null;

  const reload = () => {
    if (loading) return loading;
    state.phase = "loading";
    state.done = 0;
    state.error = undefined;
    loading = o
      .load((done, total) => {
        state.done = done;
        state.total = total;
      })
      .then((r) => {
        const m = new Map<string, AgentTownEvent[]>();
        for (const e of r.events) {
          if (!e.taskId) continue;
          const l = m.get(e.taskId);
          if (l) l.push(e);
          else m.set(e.taskId, [e]);
        }
        byTask = m;
        payload = compactPayload(r.events, r.mtimes, now());
        state.phase = "ready";
      })
      .catch((err: unknown) => {
        state.phase = "error";
        state.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };
  void reload();

  const json = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (path === "/api/status") return json(res, 200, state);
    if (path === "/api/world") return payload && state.phase === "ready" ? json(res, 200, payload) : json(res, 503, state);
    if (path.startsWith("/api/task/")) {
      const id = decodeURIComponent(path.slice("/api/task/".length));
      const evs = byTask.get(id);
      return evs ? json(res, 200, { events: evs }) : json(res, 404, { error: "no such task" });
    }
    if (path === "/api/refresh" && req.method === "POST") {
      void reload();
      return json(res, 202, state);
    }
    if (path.startsWith("/api/")) return json(res, 404, { error: "no such route" });
    if (!o.staticDir) return json(res, 404, { error: "no web build" });

    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      return json(res, 400, { error: "bad path" });
    }
    const file = normalize(join(o.staticDir, rel));
    if (rel.split(/[\\/]/).includes("..") || !(file + sep).startsWith(normalize(o.staticDir) + sep) && file !== normalize(o.staticDir)) {
      return json(res, 403, { error: "outside the web build" });
    }
    const target = existsSync(file) && statSync(file).isFile() ? file : join(o.staticDir, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(readFileSync(target));
  });
  return { server, state: () => ({ ...state }), reload };
}
