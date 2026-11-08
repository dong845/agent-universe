#!/usr/bin/env node
// Builds the npm package in release/ (spec 2026-11-08 D30 A1): `node scripts/pack.mjs`.
// `--check` then packs it, installs the tarball into a temporary folder and runs `agent-universe` on
// synthetic logs with a temporary home: status ready, the synthetic towns in the world, the page served.
// Nothing is published here; `npm publish` is the owner's call.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { needsBuild } from "./start.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release");
const lib = join(out, "lib");
const VERSION = "0.1.0";

function build() {
  if (needsBuild(root)) execFileSync(process.execPath, ["--run", "build"], { cwd: root, stdio: "inherit" });
  rmSync(out, { recursive: true, force: true });
  execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(root, "tsconfig.release.json")], { cwd: root, stdio: "inherit" });
  cpSync(join(root, "scripts", "start.mjs"), join(lib, "scripts", "start.mjs"));
  for (const f of readdirSync(join(root, "config"))) if (f.endsWith(".json")) cpSync(join(root, "config", f), join(lib, "config", f), { recursive: true });
  cpSync(join(root, "packages", "web", "dist"), join(lib, "packages", "web", "dist"), { recursive: true });
  for (const f of ["README.md", "README.zh.md"]) cpSync(join(root, f), join(out, f));
  // every compiled file is an ES module
  writeFileSync(join(lib, "package.json"), JSON.stringify({ type: "module" }) + "\n");
  writeFileSync(join(out, "package.json"), JSON.stringify({
    name: "agent-universe",
    version: VERSION,
    description: "Your Claude Code and Codex work, drawn as a universe that grows with it — read from the logs on your own computer, shown only there.",
    type: "module",
    bin: { "agent-universe": "lib/scripts/start.mjs" },
    files: ["lib", "README.md", "README.zh.md"],
    engines: { node: ">=22.18" },
    os: ["darwin", "linux"],
    keywords: ["claude-code", "codex", "visualization", "agents", "three.js"],
  }, null, 2) + "\n");
  // the parts that must never ship
  const bad = listFiles(out).filter((f) => /\.ts$|\.jsonl$|[\\/]logos[\\/]|\.DS_Store$/.test(f));
  if (bad.length) throw new Error(`release/ holds files that must not ship:\n${bad.join("\n")}`);
  console.log(`release/ ready: ${listFiles(out).length} files`);
}

function listFiles(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(d, e.name)) : [join(d, e.name)]));
}

async function check() {
  const tgz = execFileSync("npm", ["pack", "--silent"], { cwd: out, encoding: "utf8" }).trim().split("\n").pop();
  const tarball = join(out, tgz);
  const prefix = mkdtempSync(join(tmpdir(), "au-install-"));
  execFileSync("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--offline", tarball], { stdio: "inherit" });
  const bin = join(prefix, "node_modules", ".bin", "agent-universe");
  if (!existsSync(bin)) throw new Error("the installed package has no agent-universe command");
  // synthetic logs; their projects outside temp folders and each its own repository (D28: temp is no town)
  const { writeClaudeSession } = await import("../tests/helpers/synthLogs.ts");
  const home = mkdtempSync(join(tmpdir(), "au-home-"));
  for (const d of ["claude", "codex"]) mkdirSync(join(home, d));
  const work = join(out, "check-work");
  const tk = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
  for (const [i, name] of ["alpha", "beta"].entries()) {
    const cwd = join(work, name);
    mkdirSync(join(cwd, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", cwd]);
    for (const day of [0, 1]) writeClaudeSession(join(home, "claude"), {
      sessionId: `s-${name}-${day}`, cwd, t0: Date.now() - 86_400_000 * (4 - i - day * 2),
      turns: Array.from({ length: 3 }, (_, k) => ({ prompt: `make part ${day}-${k}`, tools: [{ name: "Write", input: { file_path: join(cwd, "src", `f${day}${k}.ts`), content: "x" } }], tokens: tk })),
    });
  }
  const port = 5194;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(bin, ["--port", String(port), "--no-open", "--claude", join(home, "claude"), "--codex", join(home, "codex"), "--no-cache"], { env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  server.stdout.on("data", (c) => (said += c));
  server.stderr.on("data", (c) => (said += c));
  try {
    let status = null;
    for (let i = 0; i < 150 && status?.phase !== "ready"; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try { status = await (await fetch(`${base}/api/status`)).json(); } catch { /* starting */ }
    }
    if (status?.phase !== "ready") throw new Error(`server never ready:\n${said}`);
    const world = await (await fetch(`${base}/api/world`)).json();
    const names = world.towns.map((t) => t.key.split("/").pop()).sort();
    if (!names.includes("alpha") || !names.includes("beta")) throw new Error(`world lacks the synthetic towns: ${names.join(", ")}`);
    const html = await (await fetch(`${base}/`)).text();
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    if (!asset) throw new Error("the page has no script");
    const js = await fetch(`${base}${asset}`);
    if (!js.ok || Number(js.headers.get("content-length") ?? (await js.clone().arrayBuffer()).byteLength) < 1000) throw new Error(`page script ${asset} not served`);
    console.log(`✓ installed ${tgz}: ready, towns ${names.join(", ")}, page ${asset}`);
  } finally {
    server.kill();
    rmSync(work, { recursive: true, force: true });
  }
}

build();
if (process.argv.includes("--check")) await check();
