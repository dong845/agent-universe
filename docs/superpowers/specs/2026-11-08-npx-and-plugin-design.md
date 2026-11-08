# One command for everyone: `npx agent-universe` and a Claude Code plugin — design (2026-11-08, D30)

The owner asked how users install Agent Universe and which form is best. Today: `git clone` + `npm start`
(Node ≥ 22.18; installs the dev dependencies with pnpm and builds the page on first run), and the repo is
private, so nobody else can. Picked: **a prebuilt npm package run with `npx agent-universe`, wrapped as
a Claude Code plugin**; **npm public, the GitHub repo stays private** (its history still holds the official
marks); **macOS + Linux**. Gemini CLI was dropped (personal accounts were cut off on 2026-06-18; its
successor stores conversations as encoded .pb files); a third agent waits for real logs.

## Facts checked (2026-11-08)

- The server, schema and adapters import only Node built-ins; the page is a static build (5.4 MB).
- At run time they read, relative to their own file: `config/{roles,themes,world}.json`, the web build
  (`../packages/web/dist` from `scripts/`), and the parser sources hashed into the cache key (`load.ts`
  `PRODUCERS`, `.ts` paths).
- Node does not strip types from files under `node_modules`, so the package must ship JavaScript.
- The npm name `agent-universe` is free. The owner's npm is not logged in. No Docker on this Mac.

## A. The package

- **A1 Layout.** `node scripts/pack.mjs` writes `release/` (git-ignored): `lib/` mirrors the repo —
  `lib/scripts/{serve,start}.js`, `lib/packages/{server,schema,adapter-claude,adapter-codex}/src/*.js`
  (compiled by `tsc` with `rewriteRelativeImportExtensions`, same folders, so every relative path still
  holds), `lib/config/*.json`, `lib/packages/web/dist/` (the page build) — plus `package.json` (name
  `agent-universe`, version from the repo, `bin: { "agent-universe": "lib/scripts/start.mjs" }`,
  `engines.node >= 22.18`, `os: [darwin, linux]`, no dependencies), `README.md`, `README.zh.md`.
- **A2 One launcher.** `scripts/start.mjs` serves both: in a clone it installs, builds and runs
  `serve.ts` as today; in the package (a `serve.js` beside it and no page sources) it skips install and
  build and runs `serve.js`. Messages name the command the user typed (`npm start` / `npx agent-universe`).
  On Windows the package says it is not supported yet and exits.
- **A3 Cache key.** `PRODUCERS` hashes the `.ts` source when it exists, else the shipped `.js`; a packaged
  run and a clone keep separate cache entries (each re-reads once), never a stale one.
- **A4 Check.** `node scripts/pack.mjs --check` packs (`npm pack`), installs the tarball into a temporary
  prefix (no network: no dependencies), runs `agent-universe --no-open` with a temporary HOME on
  synthetic logs, and requires: status ready, the world has the synthetic towns, `/` serves the page and a
  page asset loads. Linux: the same check in GitHub Actions (ubuntu) — added only with the owner's yes,
  since it pushes a workflow.
- **A5 Publishing** is not part of the build: `npm publish` runs only when the owner says so, after
  `npm login`.

## B. The Claude Code plugin

- **B1** A small separate folder (`~/code_project/agent-universe-plugin`, later its own public repo): a
  plugin manifest, a marketplace file, and a command `/agent-universe` that starts
  `npx -y agent-universe@latest --no-open` in the background if it is not running and gives the link.
  Format checked against the current Claude Code plugin docs before writing it. Creating the public
  repo is the owner's call.

## Non-goals

Windows; a desktop app; a third agent; publishing without the owner's word.

## How we'll know

- Unit: launcher mode detection (clone vs package), `PRODUCERS` fallback.
- `pack.mjs --check` green on this Mac, and the packed tarball's file list has no logs, cache, `.ts`
  sources of the page, or official marks.
- A look at the page served from the installed package.
