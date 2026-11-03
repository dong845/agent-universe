#!/usr/bin/env node
// Agent Universe · 智能体宇宙 — one command after cloning (spec 2026-11-03 C3):
//   npm start            (or: node --run start, node scripts/start.mjs)
// Checks Node, installs the dependencies with the pnpm that Node's corepack ships, builds the page when
// the build is missing or older than the sources, starts the local server and opens the browser.
// Plain JavaScript on purpose: it must be able to say "your Node is too old" on that old Node.
// Options are passed on to the server (--port, --claude, --codex, --no-cache, --port-file); --no-open
// leaves the browser alone.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIN = [22, 18];

/** TypeScript runs directly from Node 22.18 (type stripping on by default) */
export function nodeOk(version = process.version) {
  const [maj, min] = version.replace(/^v/, "").split(".").map(Number);
  return maj > MIN[0] || (maj === MIN[0] && min >= MIN[1]);
}

const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

/** dependencies missing, or older than the lockfile */
export function needsInstall(root) {
  const marker = join(root, "node_modules", ".modules.yaml");
  return !existsSync(marker) || mtime(join(root, "pnpm-lock.yaml")) > mtime(marker);
}

/** the newest source file under the page's and the shared packages' sources */
function newestSource(root) {
  let newest = 0;
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else newest = Math.max(newest, st.mtimeMs);
    }
  };
  for (const d of ["packages/web/src", "packages/web/index.html", "packages/web/public", "packages/schema/src", "packages/mock/src", "config", "art/manifest.json"]) {
    const p = join(root, d);
    if (existsSync(p) && statSync(p).isFile()) newest = Math.max(newest, mtime(p));
    else walk(p);
  }
  return newest;
}

/** no build, or a source newer than it */
export function needsBuild(root) {
  const built = mtime(join(root, "packages", "web", "dist", "index.html"));
  return !built || newestSource(root) > built;
}

function run(cmd, args, root, what) {
  console.log(`→ ${what}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" } });
  if (r.status !== 0) {
    console.error(`✗ ${what}失败（${cmd} ${args.join(" ")}，退出码 ${r.status ?? r.signal}）`);
    process.exit(1);
  }
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    console.log(`请在浏览器打开 ${url}`);
  }
}

async function alreadyRunning(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(800) });
    return r.ok && typeof (await r.json()).phase === "string";
  } catch {
    return false;
  }
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const noOpen = args.includes("--no-open");
  const pass = args.filter((a) => a !== "--no-open");
  const pi = pass.indexOf("--port");
  const port = pi >= 0 ? Number(pass[pi + 1]) : 5182;
  const url = `http://127.0.0.1:${port}/`;

  if (!nodeOk()) {
    console.error(`✗ 需要 Node ${MIN.join(".")} 或更新（现在是 ${process.version}）。到 https://nodejs.org 下载 LTS 版本后再运行 npm start。`);
    process.exit(1);
  }
  if (await alreadyRunning(port)) {
    console.log(`Agent Universe 已经在运行：${url}`);
    if (!noOpen) openBrowser(url);
    return;
  }
  if (needsInstall(root)) run(process.platform === "win32" ? "corepack.cmd" : "corepack", ["pnpm", "install", "--frozen-lockfile"], root, "安装依赖（第一次需要一两分钟）");
  if (needsBuild(root)) run(process.execPath, ["--run", "build"], root, "构建网页");

  const server = spawn(process.execPath, [join(root, "scripts", "serve.ts"), ...pass], { cwd: root, stdio: "inherit" });
  server.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
  // open the page once the server answers (it shows its own progress while reading the logs)
  for (let i = 0; i < 100; i++) {
    if (await alreadyRunning(port)) {
      if (!noOpen) openBrowser(url);
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// run only when started directly (the tests import the checks)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
