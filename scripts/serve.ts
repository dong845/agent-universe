// Agent Town's local server: node scripts/serve.ts [--port 5182] [--claude <root>] [--codex <root>] [--no-cache]
// Reads this machine's Claude Code and Codex logs and serves the world on 127.0.0.1 only.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, portInUseMessage } from "../packages/server/src/http.ts";
import { loadEventsAsync } from "../packages/server/src/load.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg("--port") ?? 5182);
const claudeRoot = arg("--claude") ?? join(homedir(), ".claude/projects");
const codexRoot = arg("--codex") ?? join(homedir(), ".codex/sessions");
const cacheDir = process.argv.includes("--no-cache") ? null : process.env.AGENT_TOWN_CACHE ?? join(homedir(), ".agent-town/cache");
const dist = new URL("../packages/web/dist", import.meta.url).pathname;

let lastPrint = 0;
const t0 = Date.now();
const srv = createServer({
  staticDir: existsSync(join(dist, "index.html")) ? dist : null,
  load: (onProgress) =>
    loadEventsAsync({
      claudeRoot,
      codexRoot,
      cacheDir,
      onProgress: (done, total) => {
        onProgress(done, total);
        if (Date.now() - lastPrint > 2000 || done === total) {
          lastPrint = Date.now();
          console.log(`读取日志 ${done}/${total}`);
        }
      },
    }).then((r) => {
      console.log(`已就绪：${r.events.length} 条事件，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒（缓存 ${r.cached}，重新解析 ${r.parsed}）`);
      return r;
    }),
});
srv.server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? portInUseMessage(port) : `启动失败：${e.message}`);
  process.exit(1);
});
srv.server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Town: http://127.0.0.1:${port}/${srv.state().phase === "loading" ? "（正在读取日志）" : ""}`);
  if (!existsSync(join(dist, "index.html"))) console.log("还没有网页构建：开发时用 pnpm dev 打开 http://127.0.0.1:5180/，或先 pnpm build");
});
