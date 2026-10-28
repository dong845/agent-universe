# World v2 · Step 1: Real Data, Click-to-Zoom, Task Diary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The world loads the owner's real Claude Code + Codex logs through a loopback-only local server, and clicking a house, site or figure zooms in and opens a task diary with the full step-by-step record (plus replay).

**Architecture:** A shared loader (refactored out of `scripts/parse.ts`) parses logs with a per-session disk cache, normalises project roots to the git root, and keeps every event in memory. `scripts/serve.ts` serves a *compact* world payload (finished tasks summarised to start / per-agent token totals / end, live tasks in full, building statistics as pre-aggregated rows) and full per-task events on demand. The web app loads that payload (or the mock with `?demo=1`), adds a selection state machine (task / site / agent) driving the camera, and a diary panel built from a pure `diaryOf()` model.

**Tech Stack:** Node 22 (type-stripping TS, `node:http`, no new deps), React 19 + R3F 9.8.2 + zustand, Vitest 5, Playwright 1.64.1 (system Chrome, SwiftShader).

**Spec:** `docs/superpowers/specs/2026-10-28-world-v2-design.md` (sections 3, 4, 8, 9, 12.2–12.7; sections 5–7 are later plans).

**Deliberately not in this step:**
- The diary's "touched files, grouped by directory, click to fly there" section. It needs the untruncated `files` field and the streets, so it ships with step 2.
- The spec's separate `/api/live` route. Live tasks travel inside `/api/world`, since `compactPayload` keeps their full events, and polling for live updates is phase 4.

## Global Constraints

- Server binds **127.0.0.1 only**; port **5182** (Vite dev 5180, preview 5181). Vite proxies `/api` → `http://127.0.0.1:5182`.
- No new npm dependencies. The server runs as `node scripts/serve.ts` (Node 22 strips types).
- Cache lives in `~/.agent-town/cache/` (override `AGENT_TOWN_CACHE`), never in the repo.
- Real logs, cache files and real-data screenshots never enter git, tests or fixtures. Tests use synthetic logs written into a temp dir by `tests/helpers/synthLogs.ts`.
- No invented numbers: missing data shows "—"; cost stays "未配置价格".
- A task with no `task_end` that is not live is **not** a success or a failure: house has no flag, normal roof, diary says "未见结束".
- "Live" = no `task_end` AND the source file was modified ≤ **10 min** before load; at most **6** live tasks animated (most recent activity first).
- Task title: first line of the task's first user message, trimmed, cut to **80** chars (add "…" when cut). Claude `ai-title`/`custom-title` = session label only.
- Project root: walk up from the session cwd to the first dir containing `.git` (dir **or** file); none found or cwd missing → cwd unchanged.
- D5 parity: `node scripts/parse.ts --against …` must stay identical after the refactor.
- Commit locally after each task, staging named paths only; never push. Identity dong845 <ldh199803@gmail.com>.
- All UI copy in Chinese, matching existing strings.

## Review Focus

1. **A project directory that no longer exists** (deleted/moved since the log) → `projectRoot` returns the cwd unchanged, no throw. Test in Task 3.
2. **A session file being written during load** (last line cut off) → loader returns the events before it, counts one bad line, no crash; the task is live. Test in Task 2.
3. **A task that never ended and is not live** (killed session) → no success flag, diary "未见结束". Tests in Tasks 4 and 7.
4. **Many projects (120 districts)** → `buildWorld` places all without overlap. Test in Task 4.
5. **Server not running / port 5182 taken** → page shows "本地服务未启动：运行 pnpm start"; `serve.ts` exits with a one-line message naming the port on `EADDRINUSE`. Tests in Tasks 5 and 6.

---

### Task 1: Task titles in both adapters

**Files:**
- Modify: `packages/adapter-claude/src/index.ts` (task_start at ~L198–206)
- Modify: `packages/adapter-codex/src/index.ts` (task_started ~L141; `user_message` is in the skip list ~L10)
- Modify: `packages/schema/src/event.ts` (`title` doc comment → "first line of the task's first user message, ≤ 80 chars; shown on this machine only")
- Create: `packages/schema/src/title.ts`
- Create: `tests/helpers/synthLogs.ts`, `tests/adapters.test.ts`

**Interfaces:**
- Produces: `titleOf(text: string): string | undefined` — first non-empty line, whitespace-collapsed, cut to 80 chars + "…"; `undefined` for empty/whitespace.
- Produces: `writeClaudeSession(dir: string, spec: SynthSession): string` and `writeCodexRollout(dir: string, spec: SynthSession): string` returning the written path; `SynthSession = { sessionId: string; cwd: string; t0: number; turns: { prompt: string; tools?: { name: string; input: Record<string, unknown>; isError?: boolean }[]; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; end?: boolean }[] }`. Record shapes follow `docs/log-formats.md` and what the adapters read; keep them minimal.

- [ ] **Step 1: Failing tests** in `tests/adapters.test.ts`:
  - `titleOf("  修复登录\n第二行")` → `"修复登录"`; `titleOf("x".repeat(100))` → 80 x's + "…"; `titleOf(" \n ")` → `undefined`.
  - Claude synth session with prompt `"Fix the checkout bug\nmore"` → its `task_start.title === "Fix the checkout bug"`.
  - Codex synth rollout whose turn has `user_message` `"重构 search index"` → `task_start.title === "重构 search index"`.
  - Token totals of both synth sessions equal the sum of the spec's tokens (guards the refactor).
- [ ] **Step 2:** `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm vitest run tests/adapters.test.ts` → FAIL.
- [ ] **Step 3:** Claude: set `title: titleOf(textOf(content))` on the human task_start (system-triggered starts keep no title). Codex: keep a reference to the current root task_start event; on the first `event_msg/user_message` inside it, set `title = titleOf(p.message)`; keep `user_message` otherwise skipped.
- [ ] **Step 4:** Tests PASS; `node scripts/parse.ts` still prints `OK`.
- [ ] **Step 5:** Commit `feat(adapters): task titles from the first user message`.

### Task 2: Shared cached loader

**Files:**
- Create: `packages/server/src/load.ts`
- Modify: `scripts/parse.ts` (use `loadEvents`; keep its summary prints, `--events`, `--totals`, `--against` behaviour)
- Test: `tests/load.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface LoadOptions { claudeRoot: string; codexRoot: string; cacheDir: string | null; onProgress?: (done: number, total: number) => void }
  interface Loaded { events: AgentTownEvent[]; /** source file → mtimeMs, for liveness */ mtimes: Map<string, number>; totals: { claude: Record<string, number[]>; codex: Record<string, number[]> }; stats: ReadStats; parsed: number; cached: number }
  function loadEvents(o: LoadOptions): Loaded
  ```
  Events are globally deduped exactly as `parse.ts` does today (earliest session owns a record) and sorted by `ts`.
- Cache unit: one Claude main session (key = main path + max(mtime,size) over `sessionFiles()`), one Codex thread (key = sorted rollout paths + their mtime/size). Value = that unit's events + totals as JSON in `<cacheDir>/<sha1(key)>.json`. Stale entries are ignored, not deleted.

- [ ] **Step 1: Failing tests:** (a) synth roots with 2 Claude + 2 Codex sessions → `loadEvents` twice: second run `parsed === 0`, `cached === 4`, events deep-equal; (b) append a turn to one file → next run `parsed === 1`; (c) a file whose last line is cut mid-JSON → no throw, `stats.badLines === 1`, earlier events present; (d) missing `codexRoot` → no throw, only Claude events; (e) `cacheDir: null` → no files written.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Move the walk/parse/dedupe code from `scripts/parse.ts` into `loadEvents`; `parse.ts` keeps CLI, prints and D5 comparison.
- [ ] **Step 4:** Tests PASS; `node scripts/parse.ts` → same event count as before the refactor (record it from a run on the commit before) and `OK`.
- [ ] **Step 5:** Commit `refactor: shared cached event loader`.

### Task 3: Project root = git root

**Files:**
- Create: `packages/server/src/projectRoot.ts`
- Modify: `packages/server/src/load.ts` (rewrite `projectId` on every event after dedupe, memoised per cwd)
- Test: `tests/projectRoot.test.ts`

**Interfaces:**
- Produces: `projectRoot(cwd: string, isGitMarker: (p: string) => boolean = defaultMarker): string`, where `defaultMarker(dir)` is `existsSync(join(dir, ".git"))` (dir or file).

- [ ] **Step 1: Failing tests** (temp dirs): `repo/.git/` + cwd `repo/a/b` → `repo`; cwd `repo` → `repo`; worktree `wt/.git` **file** + cwd `wt/src` → `wt`; no `.git` anywhere → cwd; cwd that does not exist → cwd unchanged, no throw; Windows-style `C:\\x\\y` with a stub marker → stops at the drive root, no infinite loop.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (walk with `dirname` until it stops changing). **Step 4:** PASS, plus a `load.test.ts` case: two synth sessions in `repo/a` and `repo/b` → one `projectId`.
- [ ] **Step 5:** Commit `feat(server): group sessions by git root`.

### Task 4: Compact world payload + ledger building rows

**Files:**
- Create: `packages/server/src/payload.ts`
- Modify: `packages/schema/src/aggregate.ts` (`buildLedger(events, buildingRows = [])`)
- Modify: `packages/web/src/orchestrator/worldgen.ts` (`House.ok: boolean | null`; null when the task has no `task_end` in the payload's ended set — see below)
- Modify: `packages/web/src/world/World.tsx` (flag only when `ok === true`; grey roof only when `ok === false`), `packages/web/src/ui/HoverCard.tsx` (house subtitle "未见结束" when null)
- Test: `tests/payload.test.ts`, `tests/worldgen.test.ts` (add cases)

**Interfaces:**
- Produces:
  ```ts
  interface BuildingRow { faction: Faction; projectId: string; building: BuildingId; ts: number; calls: number; durationMs: number; attributedInput: number }
  interface WorldPayload { events: AgentTownEvent[]; buildingRows: BuildingRow[]; liveTaskIds: string[]; generatedAt: number; source: "real" | "demo" }
  function compactPayload(full: AgentTownEvent[], mtimes: Map<string, number>, now: number, opts?: { liveWindowMs?: number; maxLive?: number }): WorldPayload
  ```
  Defaults `liveWindowMs = 600_000`, `maxLive = 6`.
- Compaction rules: live tasks → all their events unchanged. Every other task → its `task_start` (with title), one `model_call` per (agentId) carrying that agent's summed tokens at the agent's last call `ts` (keep `agentId`, `sessionId`, `model` = last model), and its `task_end` if one exists (none → nothing; worldgen marks the house `ok: null`, `builtAt` = task's last event ts). Model calls with `taskId === null` → one summed `model_call` per (session, agentId, UTC hour). Building statistics for non-live events → `BuildingRow`s, one per (district, building, task) at the task's last ts, computed with the same rules as `buildLedger` (extract that logic into an exported `buildingDeltas(events): BuildingRow[]` in `aggregate.ts` and use it in both places).
- `buildLedger(events, rows)` adds each row as a building bump at `row.ts`.

- [ ] **Step 1: Failing tests:** on the synth corpus (plus a third Claude session with no task_end, mtime 2 h old): (a) for every key in `keys.global/faction/district/session/task/taskSubagents`, `buildLedger(full).tokensAt(k, END)` equals `buildLedger(p.events, p.buildingRows).tokensAt(k, END)`; (b) same for `buildingAt` of every building key; (c) `liveTaskIds` contains the task whose file mtime is `now − 5 min` and no task older than 10 min; with 8 qualifying tasks only the 6 with latest activity; (d) the no-end task's house has `ok === null`; (e) payload `events.length` ≤ 4 × tasks + live events; (f) `buildWorld` of 120 synthetic districts (60 per faction, random paths) → no two districts overlap (reuse the existing overlap check).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, whole `vitest run` green.
- [ ] **Step 5:** Commit `feat(server): compact world payload`.

### Task 5: Local HTTP server

**Files:**
- Create: `packages/server/src/http.ts`, `scripts/serve.ts`
- Modify: root `package.json` (`"start": "pnpm build && node scripts/serve.ts"`, `"serve": "node scripts/serve.ts"`), `packages/web/vite.config.ts` (`server.proxy: { "/api": "http://127.0.0.1:5182" }`)
- Test: `tests/http.test.ts`

**Interfaces:**
- Produces: `createServer(o: { load: () => Loaded; staticDir: string | null; now?: () => number }): { server: http.Server; state(): { phase: "loading" | "ready" | "error"; done: number; total: number; error?: string } }`. Loading starts on creation, asynchronously (`setImmediate` between units, so `/api/status` answers while loading).
- Routes: `GET /api/status` → state; `GET /api/world` → `WorldPayload` (503 `{phase}` while loading); `GET /api/task/:id` → `{ events: AgentTownEvent[] }` (all events with that `taskId`, sorted) or 404; `POST /api/refresh` → reload, 202; everything else → static file from `staticDir` (`index.html` fallback), with `..`/absolute paths rejected (403). JSON responses `cache-control: no-store`.
- `scripts/serve.ts`: listens on `127.0.0.1:5182` (`--port`), prints `Agent Town: http://127.0.0.1:5182/`, prints progress lines, on `EADDRINUSE` prints `端口 5182 已被占用：可能已经有一个 Agent Town 在运行` and exits 1.

- [ ] **Step 1: Failing tests** (port 0, synth roots): status reaches `ready`; `/api/world` 200 with `source: "real"`; `/api/task/<known>` events all share that taskId; `/api/task/nope` 404; `GET /../package.json` 403; `server.address().address === "127.0.0.1"`; a second `listen` on the same port → the serve wrapper's EADDRINUSE handler message (test the handler function `portInUseMessage(port)` directly).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(server): loopback API for the world`.

### Task 6: Web loads real data (demo behind `?demo=1`)

**Files:**
- Create: `packages/web/src/data.ts`, `packages/web/src/ui/Loading.tsx`
- Modify: `packages/web/src/main.tsx`, `packages/web/src/store.ts`, `packages/web/src/App.tsx` (badge), `packages/web/src/styles.css`, `packages/mock/src/world.ts` (export `demoPayload(): WorldPayload`)
- Test: `packages/web/e2e/world.spec.ts` (existing tests switch to `?demo=1`)

**Interfaces:**
- Produces: `loadWorld(demo: boolean): Promise<WorldPayload>` (demo → `demoPayload()`; else poll `/api/status` every 500 ms reporting progress, then `/api/world`); `fetchTask(taskId: string): Promise<AgentTownEvent[]>` (demo → filter in-memory events; else `/api/task/:id`, memoised).
- Store: `load(p: WorldPayload)` replaces `load(events)`; keeps `source`. **Clock:** demo keeps today's live-window clock. Real: `t0` = earliest event ts, `duration` = latest − t0, start at `t = duration`, paused (default view = now). Live runtimes get `offset = timeline.t0 − t0` as now.
- Badge: demo → existing text; real → `真实数据 · 仅本机`.
- `Loading`: "正在读取本机日志 {done}/{total}"; on fetch failure "本地服务未启动：运行 pnpm start" (no world drawn).

- [ ] **Step 1:** Update existing Playwright specs to open `/?demo=1…`; add a spec: route `/api/status` to abort → page shows the "本地服务未启动" text.
- [ ] **Step 2:** FAIL (new spec). **Step 3:** Implement. **Step 4:** `pnpm e2e` all green; `pnpm build` passes `tsc`.
- [ ] **Step 5:** Manual: `pnpm serve` + Vite dev, open `http://127.0.0.1:5180/` → real towns render; record the district count and load time (cold, then cached) for the hand-off. Screenshot only to the scratchpad. **Do not commit any real-data artifact.**
- [ ] **Step 6:** Commit `feat(web): real data by default, demo behind ?demo=1`.

### Task 7: Selection, camera push-in, follow

**Files:**
- Create: `packages/web/src/selection.ts`
- Modify: `packages/web/src/store.ts`, `packages/web/src/world/Camera.tsx`, `packages/web/src/world/World.tsx` (house `onClick` via `instanceId`), `packages/web/src/world/Site.tsx` and `packages/web/src/world/Figures.tsx` (`onClick`), `packages/web/src/main.tsx` (test hook `select`)
- Test: `tests/selection.test.ts`, `packages/web/e2e/world.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  type Selection = { kind: "task"; district: string; taskId: string } | { kind: "site"; district: string } | { kind: "agent"; district: string; agentId: string };
  // store
  selected: Selection | null; select(s: Selection | null): void; back(): void;
  // selection.ts (pure)
  function toHash(s: Selection | null): string;          // "#task=<district>~<taskId>" | "#site=<district>" | "#agent=<district>~<agentId>" | ""
  function fromHash(h: string): Selection | null;        // inverse; malformed → null
  const TASK_ZOOM = 40;
  ```
  `back()`: selection → null (focus unchanged); no selection + focus → focus null.
- Camera: `task` → target = house position, zoom `TASK_ZOOM`; `site` → district origin, zoom 34; `agent` → every frame, target lerps to `sampleActor(actor, lt).pos` (+ district origin), zoom 34, until the user drags (existing "start" handler clears the follow). Selecting also sets `focus` to the district.
- Clicks: ignore if the pointer moved > 5 px since pointerdown (a drag). `Escape` → `back()`. Hash written on select, read once at startup after load.

- [ ] **Step 1: Failing unit tests:** `fromHash(toHash(s))` round-trips all three kinds incl. keys with `|`, `/`, `~` and Chinese (encode with `encodeURIComponent`); `fromHash("#task=")`, `fromHash("#bogus=1")` → null.
- [ ] **Step 2: Failing e2e:** demo, world view → click the screen point of a history house (`__agentTown.toScreen` of its `at`) → within 3 s camera zoom ≥ 38 and `location.hash` starts `#task=`; press Escape → hash empty; click a figure → `snapshot().selected.kind === "agent"` and camera target within 1.5 units of the figure over 2 s of playback; a drag starting on a house does **not** select.
- [ ] **Step 3:** Implement. **Step 4:** PASS (unit + e2e).
- [ ] **Step 5:** Commit `feat(web): click to zoom into a task, site or agent`.

### Task 8: Task diary panel + replay

**Files:**
- Create: `packages/web/src/ui/diaryModel.ts`, `packages/web/src/ui/Diary.tsx`
- Modify: `packages/web/src/store.ts` (`replay`), `packages/web/src/App.tsx`, `packages/web/src/styles.css`
- Test: `tests/diary.test.ts`, `packages/web/e2e/world.spec.ts`

**Interfaces:**
- Consumes: `fetchTask` (Task 6), `Selection` (Task 7), `detectRework` from `schema/src/insights.ts`, `ROLE_NAMES`.
- Produces:
  ```ts
  interface DiaryStep { ts: number; agentId: string; role?: Role; tool: string; target?: string; status: "ok" | "error" | "denied" | "running"; tokens: number /* tokens of the next model_call by the same agent, 0 if none */ }
  interface DiaryAgent { agentId: string; agentType?: string; agentTask?: string; steps: DiaryStep[]; tokens: number }
  interface Diary { taskId: string; title?: string; faction: Faction; projectId: string; models: string[]; start: number; end: number | null; outcome: "ok" | "error" | "unknown" | "running"; tokens: Tokens; subagentTokens: number; main: DiaryStep[]; agents: DiaryAgent[]; rework: { file: string; edits: number }[]; replayable: boolean }
  function diaryOf(events: AgentTownEvent[], taskId: string, live: boolean): Diary
  // store
  replay: { district: string; taskId: string } | null; startReplay(district: string, events: AgentTownEvent[]): void; stopReplay(): void;
  ```
  `replayable` = the task has ≥ 1 `tool_start`. Demo history tasks have none → button disabled with title "这个演示任务只有摘要，没有逐步记录".
- Replay (my call, deviating from spec §4 wording "at the house's position"): the town's central site rebuilds the task — `startReplay` swaps that district's runtime for `{ timeline: buildTimeline(events), offset: t }`, extends `duration` to `t + timeline.duration`, sets playing; the selected house gets an outline highlight; `stopReplay` (or selection change) restores the original runtime and duration. Reason: every site animation (lanes, scaffolds, doors) is laid out around the central plaza; moving it to a house slot is step-2 work once streets exist.
- Panel (right side, 360 px, slides in; closes on Escape/back): header title (or "（无标题）"), faction · project basename · models; rows 开始/结束/用时/结果 (结果: 成功/失败/未见结束/进行中); TokenRows (reuse from HoverCard, export it) + 其中子代理; 步骤 list (time `HH:MM:SS`, role icon/name, tool, target ellipsised, tokens via `formatCount`, red for error/denied); subagents collapsed groups "子代理 · {agentType} · {n} 步 · {tokens}"; 返工 list; 重放 button. Long lists virtualise by rendering the first 200 steps + "还有 N 步" expander.

- [ ] **Step 1: Failing unit tests** (`tests/diary.test.ts`, using `demoScenario()` events): diary of the demo live task has `outcome` per its task_end, `main.length` = its main-agent tool_starts, each subagent appears once in `agents` with its steps, `tokens` total equals `ledger.tokensAt(keys.task(id), end)`; `subagentTokens` equals `keys.taskSubagents`; a task with no task_end and `live=false` → `outcome: "unknown"`, `end: null`; a step whose tool_end is denied → `status: "denied"`; history task → `replayable: false`; empty events → throws `Error("no events for task <id>")`.
- [ ] **Step 2: Failing e2e:** select the demo live task's house-or-site → `[data-testid=diary]` visible with the title text and ≥ 1 step row; Escape hides it; on a demo history house the 重放 button is disabled; on the live Claude task press 重放 → within 2 s `snapshot().replay.taskId` set and the site's floor count goes from 0 upward over 3 s of playback.
- [ ] **Step 3:** Implement. **Step 4:** PASS; full `vitest run` and `pnpm e2e` green; `pnpm build` green.
- [ ] **Step 5:** Commit `feat(web): task diary with replay`.

### Task 9: Real-data verification and hand-off

**Files:**
- Modify: `packages/web/e2e/fps.mjs` (accept a base URL; default demo), `docs/decisions.md` (new D14: what step 1 shipped, measured numbers, the replay deviation)

- [ ] **Step 1:** With real data: `pnpm start`, run `fps.mjs http://127.0.0.1:5182/` in world view and in the largest town → record fps and p95. Pass bar: ≥ 55 fps, p95 ≤ 20 ms on the M4. If below, use the existing quality levers and record which.
- [ ] **Step 2:** `node scripts/parse.ts --against <fresh probe JSONs>` → D5 identical.
- [ ] **Step 3:** Look at the real world yourself: screenshot world view, one Claude town, one Codex town, an open diary on a real task, to `~/Downloads/agent-town-v2-step1/` (Desktop is not readable from this session). Check: titles render, no "undefined"/"NaN", diary numbers match the hover card.
- [ ] **Step 4:** Write D14, commit `docs: D14 world v2 step 1` (docs only; no real-data artifact).
