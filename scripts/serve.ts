// Agent Town's local server: node scripts/serve.ts [--port 5182] [--claude <root>] [--codex <root>] [--no-cache] [--port-file <path>]
// Reads this machine's Claude Code and Codex logs and serves the world on 127.0.0.1 only.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parsePort, staticDirFrom } from "../packages/server/src/cli.ts";
import { createServer, portInUseMessage } from "../packages/server/src/http.ts";
import { loadEventsAsync } from "../packages/server/src/load.ts";
import { watchRoots } from "../packages/server/src/watch.ts";
import { createNotifier, osascriptSend } from "../packages/server/src/notify.ts";
import { readSettings } from "../packages/server/src/settings.ts";
import { langOf, say } from "../packages/server/src/text.ts";
const LANG = langOf();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

let port: number;
try {
  port = parsePort(arg("--port"));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const claudeRoot = arg("--claude") ?? join(homedir(), ".claude/projects");
const codexRoot = arg("--codex") ?? join(homedir(), ".codex/sessions");
const cacheDir = process.argv.includes("--no-cache") ? null : process.env.AGENT_TOWN_CACHE ?? join(homedir(), ".agent-town/cache");
const dist = staticDirFrom(new URL(import.meta.url));

let lastPrint = 0;
let t0 = Date.now();
// parsed units kept between reloads, so a watched change re-reads only what changed
const memo = new Map();
// a parser per live session: a session that only grew is read from where it stopped (spec 2026-11-03 A1)
const live = new Map();
const srv = createServer({
  home: homedir(),
  roots: { claude: claudeRoot, codex: codexRoot },
  // new log lines reach the page within seconds (spec 2026-11-01 A1)
  watch: (onChange) => watchRoots([claudeRoot, codexRoot], onChange),
  staticDir: existsSync(join(dist, "index.html")) ? dist : null,
  load: (onProgress) => {
    t0 = Date.now();
    return loadEventsAsync({
      claudeRoot,
      codexRoot,
      cacheDir,
      memo,
      live,
      onProgress: (done, total) => {
        onProgress(done, total);
        if (Date.now() - lastPrint > 2000 || done === total) {
          lastPrint = Date.now();
          console.log(say(LANG, "serve.reading", { done, total }));
        }
      },
    }).then((r) => {
      console.log(say(LANG, "serve.ready", { n: r.events.length, s: ((Date.now() - t0) / 1000).toFixed(1), cached: r.cached, parsed: r.parsed, tailed: r.tailed }));
      return r;
    });
  },
});
// macOS notifications for sessions that need the owner (spec 2026-11-01 A5)
srv.onAttention(createNotifier(osascriptSend, () => readSettings(srv.settingsFile), srv.townName));
srv.server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? portInUseMessage(port) : say(LANG, "serve.failed", { why: e.message }));
  process.exit(1);
});
srv.server.listen(port, "127.0.0.1", () => {
  // the installed hooks read the port from here, so a server on another port needs no re-install
  try {
    const portFile = arg("--port-file") ?? join(homedir(), ".agent-town", "port");
    mkdirSync(dirname(portFile), { recursive: true });
    writeFileSync(portFile, String(port));
  } catch (e) {
    console.error(say(LANG, "serve.portFile", { why: (e as Error).message }));
  }
  console.log(say(LANG, "serve.url", { url: `http://127.0.0.1:${port}/`, loading: srv.state().phase === "loading" ? say(LANG, "serve.loading") : "" }));
  if (!existsSync(join(dist, "index.html"))) console.log(say(LANG, "serve.noBuild"));
});
