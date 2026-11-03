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
          console.log(`读取日志 ${done}/${total}`);
        }
      },
    }).then((r) => {
      console.log(`已就绪：${r.events.length} 条事件，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒（缓存 ${r.cached}，重新解析 ${r.parsed}，续读 ${r.tailed}）`);
      return r;
    });
  },
});
// macOS notifications for sessions that need the owner (spec 2026-11-01 A5)
srv.onAttention(createNotifier(osascriptSend, () => readSettings(srv.settingsFile), srv.townName));
srv.server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? portInUseMessage(port) : `启动失败：${e.message}`);
  process.exit(1);
});
srv.server.listen(port, "127.0.0.1", () => {
  // the installed hooks read the port from here, so a server on another port needs no re-install
  try {
    const portFile = arg("--port-file") ?? join(homedir(), ".agent-town", "port");
    mkdirSync(dirname(portFile), { recursive: true });
    writeFileSync(portFile, String(port));
  } catch (e) {
    console.error(`写端口文件失败：${(e as Error).message}`);
  }
  console.log(`Agent Town: http://127.0.0.1:${port}/${srv.state().phase === "loading" ? "（正在读取日志）" : ""}`);
  if (!existsSync(join(dist, "index.html"))) console.log("还没有网页构建：先运行 node --run build；开发时用 node --run dev 打开 http://127.0.0.1:5180/");
});
