// The local server (spec 3): loopback only, no dependencies. It loads the logs once at start (and on
// /api/refresh), keeps every event in memory, and serves the compact world, one task's or one
// request's full events on demand, the built page, and (v3) saves the owner's theme choices locally.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { attentionOf, type Attention, type HookSignal } from "../../schema/src/attention.ts";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import { themeIds } from "../../schema/src/themes.ts";
import { buildTowns } from "../../schema/src/towns.ts";
import type { Loaded } from "./load.ts";
import { compactPayload, townOptions, type WorldPayload } from "./payload.ts";
import { readOverrides } from "./townsFs.ts";
import { readSettings, writeSettings, type Settings } from "./settings.ts";
import { hooksInstalled, installHooks, uninstallHooks, type HookAgent } from "./hooks.ts";
import { makeShareIds, shareSecret } from "./shareKeys.ts";
import { downloadLogos, readLogos, removeLogos } from "./logos.ts";
import { codeNames, sharePayload } from "../../schema/src/share.ts";
import { buildShareHtml, SHARE_MAX_BYTES, ShareTooBig } from "./exportShare.ts";
import type { Faction } from "../../schema/src/event.ts";
import { langOf, say } from "./text.ts";
import { randomBytes } from "node:crypto";
import { createAsks } from "./ask.ts";

export interface ServerState {
  phase: "loading" | "ready" | "error";
  /** where the logs are read from, so an empty world can say where it looked */
  roots?: { claude: string; codex: string };
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
  /** starts watching the logs; calls back when they changed; returns a stop function */
  watch?: (onChange: () => void) => () => void;
  /** a watched change reloads no sooner than this after the last reload ended, or twice that reload's duration if longer */
  reloadGapMs?: number;
  /** the owner's settings (default ~/.agent-town/settings.json) */
  settingsFile?: string;
  /** where each agent keeps its hooks (default ~/.claude/settings.json, ~/.codex/hooks.json) */
  hookFiles?: Record<HookAgent, string>;
  /** the secret behind code names and share ids (default ~/.agent-town/share-secret, created once) */
  shareSecretFile?: string;
  /** the share page's hard size limit (default 40 MB) */
  shareMaxBytes?: number;
  /** where downloaded official marks live (default ~/.agent-town/logos); `logoFetch` replaces fetch in tests */
  logosDir?: string;
  logoFetch?: typeof fetch;
  /** the log folders, reported in /api/status */
  roots?: { claude: string; codex: string };
}

/** how often attention is recomputed without new events (time alone makes a call "maybe waiting") */
const ATTENTION_TICK_MS = 5000;
const PING_MS = 25_000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

export function portInUseMessage(port: number): string {
  return say(langOf(), "port.inUse", { port });
}

export function createServer(o: ServerOptions) {
  const now = o.now ?? Date.now;
  const state: ServerState = { phase: "loading", done: 0, total: 0, ...(o.roots ? { roots: o.roots } : {}) };
  let payload: WorldPayload | null = null;
  let byTask = new Map<string, AgentTownEvent[]>();
  let byRequest = new Map<string, AgentTownEvent[]>();
  let all: AgentTownEvent[] = [];
  let loading: Promise<void> | null = null;
  let again = false;
  let requestOf = new Map<string, string>();
  let hooks: HookSignal[] = [];
  let attention: Attention[] = [];
  const streams = new Set<http.ServerResponse>();
  /** answering from the page (spec 2026-11-05 D26 B): held hooks, and the token only this server's page can read */
  const askToken = randomBytes(16).toString("hex");
  const asks = createAsks({ onChange: () => send("asks", asks.pending()) });
  /** the newest event of a session, for letting go of held hooks the record shows answered */
  const lastTsOf = (session: string): number => {
    for (let i = all.length - 1; i >= 0; i--) if (`${all[i].faction}|${all[i].sessionId}` === session) return all[i].ts;
    return -Infinity;
  };
  const attentionListeners = new Set<(a: Attention[]) => void>();
  const send = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const r of streams) r.write(msg);
  };
  const recompute = () => {
    if (state.phase !== "ready") return;
    const t = now();
    hooks = hooks.filter((h) => t - h.ts < 600_000);
    const next = attentionOf(all, t, hooks, requestOf);
    if (JSON.stringify(next) === JSON.stringify(attention)) return;
    attention = next;
    send("attention", attention);
    asks.settle((p) => !attention.some((a) => a.session === p.session && a.state === "waiting") && lastTsOf(p.session) > p.since);
    for (const l of attentionListeners) l(attention);
  };
  const themesFile = o.themesFile ?? join(homedir(), ".agent-town", "themes.json");
  const settingsFile = o.settingsFile ?? join(homedir(), ".agent-town", "settings.json");
  /** the language the page last chose (its messages are worded in it), else the server's LANG */
  const pageLang = () => readSettings(settingsFile).lang ?? langOf();
  const logosDir = o.logosDir ?? join(homedir(), ".agent-town", "logos");
  const secretFile = o.shareSecretFile ?? join(homedir(), ".agent-town", "share-secret");
  const shareIds = () => makeShareIds(shareSecret(secretFile));
  const hookFiles = o.hookFiles ?? { claude: join(homedir(), ".claude", "settings.json"), codex: join(homedir(), ".codex", "hooks.json") };
  const towns = () => townOptions({ overrides: readOverrides(themesFile) }, o.home);

  let lastEnd = 0;
  let lastDur = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  /** a watched change: reload soon, but never back to back — a huge live session takes seconds to re-read */
  const requestReload = () => {
    if (pending) return;
    const gap = Math.max(o.reloadGapMs ?? 3000, 2 * lastDur);
    pending = setTimeout(() => {
      pending = null;
      void reload();
    }, Math.max(0, lastEnd + gap - Date.now()));
  };
  const reload = (): Promise<void> => {
    if (loading) {
      // logs changed while reading: read once more afterwards, so the last write is never lost
      again = true;
      return loading;
    }
    const started = Date.now();
    // a reload with data already shown stays "ready": the page keeps the old world until the new one is in
    if (!payload) state.phase = "loading";
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
        requestOf = r.requestOf;
        payload = compactPayload(r.events, r.mtimes, now(), { home: o.home, requestOf: r.requestOf, towns: towns() });
        state.phase = "ready";
        send("world", { generatedAt: payload.generatedAt });
        attention = [];
        recompute();
        if (!attention.length) send("attention", attention);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        // a watched reload that fails keeps the last good world (and its alerts); only a first load errors
        if (payload) {
          state.phase = "ready";
          console.error(say(langOf(), "reload.failed", { why: message }));
          return;
        }
        state.phase = "error";
        state.error = message;
      })
      .finally(() => {
        loading = null;
        lastEnd = Date.now();
        lastDur = lastEnd - started;
        if (again) {
          again = false;
          void reload();
        }
      });
    return loading;
  };
  void reload();
  const stopWatch = o.watch?.(requestReload);
  const tick = setInterval(recompute, ATTENTION_TICK_MS);
  const ping = setInterval(() => { for (const r of streams) r.write(": ping\n\n"); }, PING_MS);
  tick.unref?.();
  ping.unref?.();

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
    if (path === "/api/status") return json(res, 200, { ...state, token: askToken });
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
    if (path === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: attention\ndata: ${JSON.stringify(attention)}\n\n`);
      res.write(`event: asks\ndata: ${JSON.stringify(asks.pending())}\n\n`);
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (path === "/api/attention") return json(res, 200, attention);
    if (path === "/api/ask" && req.method === "POST") return receiveAsk(req, res, url.searchParams.get("src"));
    if (path === "/api/asks") return json(res, 200, asks.pending());
    if (path === "/api/presence" && req.method === "POST") {
      asks.heartbeat();
      res.writeHead(204, { "cache-control": "no-store" });
      return res.end();
    }
    if ((path === "/api/ask/answer" || path === "/api/ask/release") && req.method === "POST") return answerAsk(req, res, path.endsWith("release"));
    // the hook switches show what the hook files really hold (the owner may have edited them by hand)
    if (path === "/api/settings" && req.method === "GET") return json(res, 200, { ...readSettings(settingsFile), hooks: { claude: hooksInstalled(hookFiles.claude), codex: hooksInstalled(hookFiles.codex) }, askHooks: { claude: hooksInstalled(hookFiles.claude, "ask"), codex: hooksInstalled(hookFiles.codex, "ask") }, hookFiles });
    if (path === "/api/settings" && req.method === "POST") return saveSettings(req, res);
    if (path === "/api/hooks" && req.method === "POST") return switchHooks(req, res);
    if (path === "/api/export/share" && req.method === "POST") return exportShare(req, res);
    if (path === "/api/logos" && req.method === "GET") return json(res, 200, readLogos(logosDir));
    if (path === "/api/logos" && req.method === "POST") return switchLogos(req, res);
    if (path === "/api/share/names") {
      if (!payload) return json(res, 503, state);
      return json(res, 200, codeNames(payload.towns.map((t) => t.key), shareIds().name));
    }
    if (path === "/api/hook" && req.method === "POST") return receiveHook(req, res, url.searchParams.get("src"));
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

  /** POST /api/settings {notify?, notifyTurnDone?, lang?}: the notification switches and the page's language (hooks change via /api/hooks) */
  const saveSettings = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = "";
    req.on("data", (c: Buffer) => { if (body.length < 4096) body += c; });
    req.on("end", () => {
      let b: Partial<Settings>;
      try {
        b = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      const cur = readSettings(settingsFile);
      const next: Settings = { ...cur, notify: typeof b.notify === "boolean" ? b.notify : cur.notify, notifyTurnDone: typeof b.notifyTurnDone === "boolean" ? b.notifyTurnDone : cur.notifyTurnDone, ...(b.lang === "zh" || b.lang === "en" ? { lang: b.lang } : {}) };
      writeSettings(settingsFile, next);
      json(res, 200, next);
    });
  };

  /**
   * POST /api/hooks {agent, on}: the owner's switch for precise alerts (spec A3). Writes the agent's own
   * hook file — only ever from this switch, with a backup — and mirrors the state in the settings.
   */
  const switchHooks = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = "";
    req.on("data", (c: Buffer) => { if (body.length < 4096) body += c; });
    req.on("end", () => {
      let b: { agent?: unknown; on?: unknown; set?: unknown };
      try {
        b = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      if ((b.agent !== "claude" && b.agent !== "codex") || typeof b.on !== "boolean") return json(res, 400, { error: "agent must be claude or codex, on a boolean" });
      const agent: HookAgent = b.agent;
      // "ask": the hook that lets the page answer (spec 2026-11-05 D26 B2); otherwise the alert hooks
      const set = b.set === "ask" ? "ask" : "alerts";
      try {
        const r = b.on ? installHooks(hookFiles[agent], agent, {}, set) : uninstallHooks(hookFiles[agent], {}, set);
        const cur = readSettings(settingsFile);
        if (set === "alerts") writeSettings(settingsFile, { ...cur, hooks: { ...cur.hooks, [agent]: b.on } });
        json(res, 200, { on: b.on, file: hookFiles[agent], ...r });
      } catch (e) {
        json(res, 409, { error: say(pageLang(), "hooks.notChanged", { file: hookFiles[agent], why: e instanceof Error ? e.message : String(e) }) });
      }
    });
  };

  /**
   * POST /api/export/share {townNames?, titles?, replays: requestId[] (≤ 5)}: the share page as one HTML file
   * (spec D), built from the production build this server serves. Everything goes through sharePayload.
   */
  const exportShare = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = "";
    req.on("data", (c: Buffer) => { if (body.length < 8192) body += c; });
    req.on("end", () => {
      if (!payload) return json(res, 503, state);
      if (!o.staticDir) return json(res, 409, { error: say(pageLang(), "export.needsBuild") });
      let b: { townNames?: unknown; titles?: unknown; replays?: unknown; lang?: unknown };
      try {
        b = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      const ids = Array.isArray(b.replays) ? b.replays.filter((x): x is string => typeof x === "string") : [];
      if (ids.length > 5) return json(res, 400, { error: say(pageLang(), "export.maxReplays") });
      try {
        const replays = ids.map((id) => ({ requestId: id, events: byRequest.get(id) ?? [] })).filter((r) => r.events.length);
        // project names on unless switched off; titles (the owner's own words) off unless switched on
        const lang = b.lang === "en" || b.lang === "zh" ? b.lang : pageLang();
        const shared = sharePayload(payload, { ids: shareIds(), townNames: b.townNames !== false, titles: b.titles === true, replays, lang });
        const html = buildShareHtml(o.staticDir, shared, o.shareMaxBytes ?? SHARE_MAX_BYTES, lang);
        const d = new Date();
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="agent-universe-share-${day}.html"`, "cache-control": "no-store" });
        res.end(html);
      } catch (e) {
        if (e instanceof ShareTooBig) return json(res, 413, { error: e.message, bytes: e.bytes, parts: e.parts });
        json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  /** POST /api/logos {on}: download the official marks from Wikimedia Commons into the owner's folder, or remove them */
  const switchLogos = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = "";
    req.on("data", (c: Buffer) => { if (body.length < 1024) body += c; });
    req.on("end", () => {
      let b: { on?: unknown };
      try {
        b = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      if (typeof b.on !== "boolean") return json(res, 400, { error: "on must be a boolean" });
      if (!b.on) {
        removeLogos(logosDir);
        return json(res, 200, { on: false });
      }
      downloadLogos(logosDir, o.logoFetch)
        .then((r) => json(res, 200, { on: true, ...r, dir: logosDir }))
        .catch((e: unknown) => json(res, 502, { error: say(pageLang(), "logos.failed", { why: e instanceof Error ? e.message : String(e) }) }));
    });
  };

  /**
   * POST /api/ask?src=claude|codex: a PermissionRequest hook waiting for an answer (spec 2026-11-05 D26 B2).
   * Held while a page watches (else answered at once with nothing); the reply body is what the hook prints.
   */
  const receiveAsk = (req: http.IncomingMessage, res: http.ServerResponse, src: string | null) => {
    let body = "";
    let tooBig = false;
    req.on("data", (c: Buffer) => {
      body += c;
      if (body.length > 262_144) tooBig = true;
    });
    req.on("end", () => {
      if (tooBig) return json(res, 413, { error: "too large" });
      if (src !== "claude" && src !== "codex") return json(res, 400, { error: "src must be claude or codex" });
      let b: Record<string, unknown>;
      try {
        b = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      // it is also the exact signal that the session waits for the owner
      if (typeof b.session_id === "string") {
        hooks.push({ session: `${src === "claude" ? "claude-code" : "codex"}|${b.session_id}`, event: "PermissionRequest", ts: now(), kind: "permission" });
        recompute();
      }
      let done = false;
      const id = asks.hold(src, b, (reply) => {
        done = true;
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(reply);
      });
      // the agent gave up waiting (its timeout, or it was answered in the terminal and stopped the hook)
      res.on("close", () => { if (!done && id) asks.drop(id); });
    });
  };

  /** POST /api/ask/answer {id, answers | behavior} and /api/ask/release {id}: only from this server's page (token) */
  const answerAsk = (req: http.IncomingMessage, res: http.ServerResponse, release: boolean) => {
    if (req.headers["x-agent-universe-token"] !== askToken) return json(res, 403, { error: "not from this page" });
    let body = "";
    req.on("data", (c: Buffer) => { if (body.length < 65_536) body += c; });
    req.on("end", () => {
      let b: { id?: unknown; answers?: unknown; behavior?: unknown };
      try {
        b = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      if (typeof b.id !== "string") return json(res, 400, { error: "no id" });
      const ok = release ? asks.release(b.id) : asks.answer(b.id, { ...(b.answers && typeof b.answers === "object" ? { answers: b.answers as Record<string, string> } : {}), ...(b.behavior === "allow" || b.behavior === "deny" ? { behavior: b.behavior } : {}) });
      json(res, ok ? 200 : 409, { ok });
    });
  };

  /** POST /api/hook?src=claude|codex: a hook's own JSON from stdin (spec A3); loopback only, via allowed() */
  const receiveHook = (req: http.IncomingMessage, res: http.ServerResponse, src: string | null) => {
    const faction = src === "claude" ? "claude-code" : src === "codex" ? "codex" : null;
    let body = "";
    let tooBig = false;
    req.on("data", (c: Buffer) => {
      body += c;
      if (body.length > 65_536) tooBig = true;
    });
    req.on("end", () => {
      if (tooBig) return json(res, 413, { error: "too large" });
      if (!faction) return json(res, 400, { error: "src must be claude or codex" });
      let b: Record<string, unknown>;
      try {
        b = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      const sid = b.session_id ?? b.sessionId ?? b["thread-id"] ?? b.thread_id;
      const event = b.hook_event_name ?? b.type;
      if (typeof sid !== "string" || typeof event !== "string") return json(res, 400, { error: "no session or event" });
      const text = `${b.notification_type ?? ""} ${b.message ?? ""}`.toLowerCase();
      hooks.push({ session: `${faction}|${sid}`, event, ts: now(), kind: event === "PermissionRequest" ? "permission" : event === "Notification" ? (/permission|approv/.test(text) ? "permission" : "idle") : undefined });
      recompute();
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
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
  server.on("close", () => {
    stopWatch?.();
    if (pending) clearTimeout(pending);
    clearInterval(tick);
    clearInterval(ping);
    for (const r of streams) r.end();
  });
  return {
    server,
    state: () => ({ ...state }),
    reload,
    attention: () => attention,
    settingsFile,
    /** a town's display name for a notification: its world name, else the folder's last part */
    townName: (projectId: string, faction: Faction) => payload?.towns.find((t) => t.key === `${faction}|${projectId}`)?.name ?? (projectId.split("/").filter(Boolean).pop() || projectId),
    onAttention: (cb: (a: Attention[]) => void) => {
      attentionListeners.add(cb);
      return () => void attentionListeners.delete(cb);
    },
  };
}
