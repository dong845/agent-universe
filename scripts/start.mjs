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

/** zh for a Chinese locale (LANG / LC_ALL / LC_MESSAGES = zh_*), English otherwise (spec 2026-11-05 D) */
export function langOf(env = process.env) {
  const v = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return v.toLowerCase().startsWith("zh") ? "zh" : "en";
}
const WORDS = {
  zh: {
    exit: "退出码 {code}", noCorepack: "。这个 Node 没有带 corepack：运行 npm install -g corepack 后再试", failed: "✗ {what}失败（{cmd}：{why}）{hint}",
    open: "请在浏览器打开 {url}", oldNode: "✗ 需要 Node {min} 或更新（现在是 {v}）。到 https://nodejs.org 下载 LTS 版本后再运行 npm start。",
    running: "Agent Universe 已经在运行：{url}", install: "安装依赖（第一次需要一两分钟）", build: "构建网页",
  },
  en: {
    exit: "exit code {code}", noCorepack: ". This Node has no corepack: run npm install -g corepack and try again", failed: "✗ {what} failed ({cmd}: {why}){hint}",
    open: "Open {url} in your browser", oldNode: "✗ Needs Node {min} or newer (this is {v}). Get the LTS version from https://nodejs.org, then run npm start again.",
    running: "Agent Universe is already running: {url}", install: "Installing dependencies (a minute or two the first time)", build: "Building the page",
  },
};
const L = langOf();
export const msg = (key, vars = {}, lang = L) => WORDS[lang][key].replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

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

/** the dependency install: corepack's pnpm; on Windows a .cmd shim, which Node runs only through a shell */
export function installCommand(platform = process.platform) {
  return { cmd: "corepack", args: ["pnpm", "install", "--frozen-lockfile"], shell: platform === "win32" };
}

function run(cmd, args, root, what, shell = false) {
  console.log(`→ ${what}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell, env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" } });
  if (r.status !== 0) {
    const why = r.error ? r.error.message : msg("exit", { code: r.status ?? r.signal });
    const hint = cmd === "corepack" && r.error ? msg("noCorepack") : "";
    console.error(msg("failed", { what, cmd: `${cmd} ${args.join(" ")}`, why, hint }));
    process.exit(1);
  }
}

/** opens the page; when the system has no opener, says where the page is instead (never crashes) */
export function openBrowser(url, override) {
  const [cmd, args] = override ? [override, [url]] : process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const say = () => console.log(msg("open", { url }));
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", say);
    child.unref();
  } catch {
    say();
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
    console.error(msg("oldNode", { min: MIN.join("."), v: process.version }));
    process.exit(1);
  }
  if (await alreadyRunning(port)) {
    console.log(msg("running", { url }));
    if (!noOpen) openBrowser(url);
    return;
  }
  if (needsInstall(root)) {
    const ic = installCommand();
    run(ic.cmd, ic.args, root, msg("install"), ic.shell);
  }
  if (needsBuild(root)) run(process.execPath, ["--run", "build"], root, msg("build"));

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
