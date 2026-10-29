// The local server (spec 3): loopback only, no dependencies. It loads the logs once at start (and on
// /api/refresh), keeps every event in memory, and serves the compact world, one task's or one
// request's full events on demand, the built page, and (v3) saves the owner's theme choices locally.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import { themeIds } from "../../schema/src/themes.ts";
import { buildTowns } from "../../schema/src/towns.ts";
import type { Loaded } from "./load.ts";
import { compactPayload, townOptions, type WorldPayload } from "./payload.ts";
import { readOverrides } from "./townsFs.ts";

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
  /** sent with the world so the home directory can be named 主目录 */
  home?: string;
  /** the owner's theme choices (default ~/.agent-town/themes.json); never in the repository */
  themesFile?: string;
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
  let byRequest = new Map<string, AgentTownEvent[]>();
  let all: AgentTownEvent[] = [];
  let loading: Promise<void> | null = null;
  const themesFile = o.themesFile ?? join(homedir(), ".agent-town", "themes.json");
  const towns = () => townOptions({ overrides: readOverrides(themesFile) }, o.home);

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
        const q = new Map<string, AgentTownEvent[]>();
        const push = (map: Map<string, AgentTownEvent[]>, k: string, e: AgentTownEvent) => {
          const l = map.get(k);
          if (l) l.push(e);
          else map.set(k, [e]);
        };
        for (const e of r.events) {
          if (!e.taskId) continue;
          push(m, e.taskId, e);
          push(q, r.requestOf.get(e.taskId) ?? e.taskId, e);
        }
        byTask = m;
        byRequest = q;
        all = r.events;
        payload = compactPayload(r.events, r.mtimes, now(), { home: o.home, requestOf: r.requestOf, towns: towns() });
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

  /**
   * DNS rebinding: a page on another name can resolve it to 127.0.0.1 and read this server as its own
   * origin. Only requests addressed to this machine by its loopback names are answered, and a POST
   * from a foreign page is refused.
   */
  const allowed = (req: http.IncomingMessage): boolean => {
    const port = (server.address() as { port?: number } | null)?.port;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!hosts.has(req.headers.host ?? "")) return false;
    const origin = req.headers.origin;
    return req.method === "GET" || req.method === "HEAD" || !origin || [...hosts].some((h) => origin === `http://${h}`);
  };

  const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (path === "/api/status") return json(res, 200, state);
    if (path === "/api/world") return payload && state.phase === "ready" ? json(res, 200, payload) : json(res, 503, state);
    if (path.startsWith("/api/task/")) {
      let id: string;
      try {
        id = decodeURIComponent(path.slice("/api/task/".length));
      } catch {
        return json(res, 400, { error: "bad task id" });
      }
      const evs = byTask.get(id);
      return evs ? json(res, 200, { events: evs }) : json(res, 404, { error: "no such task" });
    }
    if (path.startsWith("/api/request/")) {
      let id: string;
      try {
        id = decodeURIComponent(path.slice("/api/request/".length));
      } catch {
        return json(res, 400, { error: "bad request id" });
      }
      const evs = byRequest.get(id);
      return evs ? json(res, 200, { requestId: id, events: evs }) : json(res, 404, { error: "no such request" });
    }
    if (path === "/api/theme" && req.method === "POST") return saveTheme(req, res);
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
  };

  /** POST /api/theme {key, theme}: the owner picks a town's theme; saved to their own file */
  const saveTheme = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = "";
    let tooBig = false;
    req.on("data", (c: Buffer) => {
      body += c;
      if (body.length > 4096) tooBig = true;
    });
    req.on("end", () => {
      try {
        if (tooBig) return json(res, 413, { error: "too large" });
        if (!payload) return json(res, 503, state);
        let b: { key?: unknown; theme?: unknown };
        try {
          b = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "bad json" });
        }
        const opts = towns();
        const fixed = new Set([opts.themes.fixed.capital.id, opts.themes.fixed.outpost.id]);
        const town = payload.towns.find((t) => t.key === b.key);
        if (typeof b.theme !== "string" || !themeIds(opts.themes).has(b.theme) || fixed.has(b.theme)) return json(res, 400, { error: "unknown theme" });
        if (!town || town.kind === "capital" || town.kind === "outpost") return json(res, 400, { error: "unknown town" });
        const over = { ...opts.overrides, [town.key]: b.theme };
        mkdirSync(dirname(themesFile), { recursive: true });
        writeFileSync(themesFile, JSON.stringify(over, null, 2) + "\n");
        payload = { ...payload, towns: buildTowns(payload.requests, all, { ...opts, overrides: over }) };
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
      } catch (e) {
        if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  const server = http.createServer((req, res) => {
    if (!allowed(req)) return json(res, 403, { error: "only this machine's loopback address is served" });
    try {
      handle(req, res);
    } catch (e) {
      // one bad request never takes the server down
      if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    }
  });
  return { server, state: () => ({ ...state }), reload };
}
