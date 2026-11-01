# Attention and Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent Town tells the owner when an agent needs them (page + macOS notification, resume command), and can share the world as a replay video and a self-contained share page with private text hidden.

**Architecture:** The server gains a log watcher, an attention computer (pure, in `schema/`), a server-sent event stream, a hook endpoint, a notifier and a hook installer. The page subscribes to the stream, shows a "需要你" list and planet rings, and gains a share mode (masked names + neutral emblems) used by an in-browser recorder and by a server-side exporter that inlines the production build into one HTML file.

**Tech Stack:** Node 24 (`node:http`, `fs.watch` recursive), TypeScript, React 19 + R3F 9, zustand, Vitest, Playwright (system Chrome), `MediaRecorder`, `gifenc` (new, MIT, client-side GIF).

**Spec:** `docs/superpowers/specs/2026-11-01-attention-and-sharing-design.md`

## Global Constraints

- Server binds 127.0.0.1 only; every new route goes through the existing `allowed()` Host/Origin check.
- Real logs, `~/.agent-town`, real screenshots never go into git, tests or fixtures; tests write synthetic logs (`tests/helpers/synthLogs.ts`) and temp settings files.
- Never write `~/.claude/settings.json` or Codex config except through the explicit hook toggle (backup first, merge, marker, undo).
- A hook command must never block the agent: `curl -s -m 1 … || true`.
- Exports never include raw events, prompts, tool inputs/outputs, paths, session ids, request titles, or the official marks.
- `maybe-waiting` threshold 20 s; `error` settle 10 s; live window = existing `LIVE_WINDOW_MS` (600 000).
- Share page: ≤ 5 replays, 15 MB target, 40 MB hard limit; built from `packages/web/dist` only.
- Recording cap 60 s.
- Copy is Chinese, as in the existing UI: "需要你", "可能在等你授权", "在等你授权", "本轮完成，等你回复", "出错停止", "复制恢复命令", "录制", "录制中 · 已隐藏真实名称", "导出分享页", "显示真实名称", "精确授权提醒（安装 hook）", "本轮完成也通知".
- Never `git add -A`; stage named paths. Never push.
- Test commands: unit `node_modules/.bin/vitest run <file>`; all `node --run test`; types `node_modules/.bin/tsc --noEmit -p packages/web`; e2e `node --run e2e -- --workers=1` (dev server 5180, SwiftShader is slow: size waits as `world.spec.ts` does).

## Review Focus

1. A session whose log is written while the page is open: the new payload must not reset camera, focus, city, selection or a running replay. (Task 6 test.)
2. Hook installer on a settings file that already has hooks for the same events, comments-free JSON with odd formatting, or no file at all: merge, never clobber; uninstall leaves other entries. (Task 5 tests.)
3. Mask on a payload whose every free-text field holds a marker: nothing survives — including `towns[].name`-like fields added later (allowlist). (Task 7 test.)
4. Recording when the city has DOM labels off-screen or hidden: only visible labels are drawn; no real names in frames while share mode is on. (Task 9 e2e.)
5. Share page opened from `file://` with every network request blocked. (Task 10 e2e.)

---

### Task 1: Session cwd and permission mode in the events

**Files:**
- Modify: `packages/schema/src/event.ts` (two optional fields on `AgentTownEvent`)
- Modify: `packages/adapter-claude/src/index.ts` (stop skipping `permission-mode` records for this purpose; set fields on `task_start`)
- Modify: `packages/adapter-codex/src/index.ts` (`turn_context` → approval policy; root `cwd`)
- Test: `tests/adapters.test.ts`

**Interfaces:**
- Produces: `AgentTownEvent.cwd?: string` and `AgentTownEvent.permissionMode?: string`, set on every `task_start`. Claude: `cwd` = the opening record's `cwd`; `permissionMode` = the latest `permission-mode` record's mode at or before the turn's start (values as logged, e.g. `default`, `acceptEdits`, `bypassPermissions`, `plan`). Codex: `cwd` = the rollout's session cwd; `permissionMode` = `turn_context.approval_policy` (e.g. `never`, `on-request`).

- [ ] **Step 1:** Read `docs/log-formats.md` and one synthetic session in `tests/helpers/synthLogs.ts`; add to the synth helpers a `permission-mode` record and a Codex `turn_context` with `approval_policy`.
- [ ] **Step 2: failing tests** `task_start carries cwd and permission mode (claude)` — two turns, mode `default` then a `permission-mode` record `bypassPermissions` between them → second turn's `permissionMode === "bypassPermissions"`, both `cwd === "/synthetic/proj"`. `task_start carries cwd and approval policy (codex)` → `permissionMode === "never"`.
- [ ] **Step 3:** Run `node_modules/.bin/vitest run tests/adapters.test.ts` → FAIL (fields undefined).
- [ ] **Step 4:** Implement in both adapters. The parser source change invalidates the cache by design (producerHash).
- [ ] **Step 5:** Run the file, then `node --run test` → PASS.
- [ ] **Step 6:** Commit `feat(adapters): session cwd and permission mode on task_start`.

### Task 2: The attention computer

**Files:**
- Create: `packages/schema/src/attention.ts`
- Test: `tests/attention.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AttentionState = "maybe-waiting" | "waiting" | "turn-done" | "error";
  export interface HookSignal { session: string; event: "Notification" | "Stop" | string; ts: number; kind?: "permission" | "idle" }
  export interface Attention { session: string /* `${faction}|${sessionId}` */; faction: Faction; projectId: string; requestId: string | null; state: AttentionState; since: number; tool?: string; exact: boolean }
  export const ATTENTION = { waitMs: 20_000, errorSettleMs: 10_000, liveWindowMs: 600_000 };
  export const NO_PROMPT_TOOLS: Set<string>; // Read, Grep, Glob, LS, TodoWrite, NotebookRead
  export const SPAWN_TOOLS: Set<string>;     // Agent, Task, spawn_agent
  export function attentionOf(events: AgentTownEvent[], now: number, hooks: HookSignal[], requestOf: Map<string, string>, opts?: Partial<typeof ATTENTION>): Attention[];
  ```
  Sorted most urgent first: waiting, maybe-waiting, error, turn-done; then newest `since`.

- [ ] **Step 1: failing tests**, one per row of the spec's A2 table plus the suppression rules, all from hand-built event arrays:
  - open `Bash` call 25 s old → `maybe-waiting`, `exact:false`, `tool:"Bash"`; 15 s old → nothing.
  - open `Read` 60 s → nothing; open `Agent` 60 s → nothing.
  - open `Bash` 25 s, turn `permissionMode:"bypassPermissions"` → nothing; Codex `permissionMode:"never"` → nothing.
  - the call's `tool_end` arrives → nothing.
  - last event `task_end` → `turn-done`; a newer `task_start` → nothing.
  - newest event `error` 12 s old → `error`; 5 s old → nothing; Codex `task_end status:"error"` → `turn-done`, not `error`.
  - hook `Notification kind:"permission"` newer than the session's last event → `waiting`, `exact:true`, replacing `maybe-waiting`; an event newer than the hook clears it.
  - session whose last event is older than `liveWindowMs` → nothing.
  - one entry per session at most; order as specified.
- [ ] **Step 2:** Run `node_modules/.bin/vitest run tests/attention.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `attentionOf` (group by session, look at the main agent's latest events; a subagent's open call counts for its session).
- [ ] **Step 4:** Run → PASS; `node --run test` → PASS.
- [ ] **Step 5:** Commit `feat(schema): attention states from events and hook signals`.

### Task 3: Watcher, stream and hook endpoint

**Files:**
- Create: `packages/server/src/watch.ts`
- Modify: `packages/server/src/http.ts`
- Modify: `scripts/serve.ts` (start the watcher; write `~/.agent-town/port`)
- Test: `tests/watch.test.ts`, `tests/http.test.ts`

**Interfaces:**
- Consumes: `attentionOf`, `HookSignal` (Task 2).
- Produces:
  - `watchRoots(roots: string[], onChange: () => void, debounceMs = 1500): () => void` (returns a stop function; missing roots are skipped, not fatal).
  - `ServerOptions.watch?: (onChange: () => void) => () => void` and `ServerOptions.portFile?: string`.
  - `createServer(...)` additionally returns `{ attention(): Attention[], onAttention(cb): () => void }`.
  - Routes: `GET /api/stream` (SSE; events `world` with `{generatedAt}` — the page then re-fetches `/api/world` — and `attention` with `Attention[]`; a comment ping every 25 s); `GET /api/attention`; `POST /api/hook?src=claude|codex` (loopback + `allowed()`, body ≤ 64 KB, JSON with `session_id`, `hook_event_name`, optional `message` / `notification_type`; maps to `HookSignal` with `session = "<faction>|<session_id>"`; `kind:"permission"` when the notification says it needs permission, else `"idle"`). Attention is recomputed after every reload, every hook, and on a 5 s timer (time alone moves `maybe-waiting`).

- [ ] **Step 1: failing tests** — `watchRoots fires once per burst` (temp dir, write 3 files within 100 ms → one call after debounce); `stream sends world after reload` (createServer with a fake `load`, open `/api/stream`, trigger the fake watcher → receive `event: world`); `hook flips maybe-waiting to waiting` (fake load returns events with an open Bash 25 s old → `/api/attention` has `maybe-waiting`; POST a Notification hook → `waiting`); `hook refused from a foreign origin` (403).
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement. `fs.watch(root, { recursive: true })`, filter to `.jsonl`; reload through the existing `reload()` (the per-unit cache keeps it cheap).
- [ ] **Step 4:** Run → PASS. Then measure on the owner's machine (no data leaves it): with the real server running, `touch` nothing — just read the server log line "已就绪 …用时" after a watcher-triggered reload. If a cached reload takes > 3 s, Ruling: make the reload re-parse only changed units and keep the rest of `all` (record the number in the ledger).
- [ ] **Step 5:** Commit `feat(server): log watcher, event stream, hook endpoint`.

### Task 4: macOS notifier and settings

**Files:**
- Create: `packages/server/src/notify.ts`, `packages/server/src/settings.ts`
- Modify: `packages/server/src/http.ts` (`GET/POST /api/settings`), `scripts/serve.ts`
- Test: `tests/notify.test.ts`

**Interfaces:**
- Produces:
  - `interface Settings { notify: boolean; notifyTurnDone: boolean; hooks: { claude: boolean; codex: boolean } }`, defaults `{ notify: true, notifyTurnDone: false, hooks: { claude: false, codex: false } }`; `readSettings(file)`, `writeSettings(file, s)` (file `~/.agent-town/settings.json`, injected).
  - `createNotifier(send: (title: string, body: string) => void, settings: () => Settings, townName: (projectId: string) => string): (list: Attention[]) => void` — sends once per (session, state) transition; `turn-done` only if `notifyTurnDone`; nothing if `notify` is off.
  - `osascriptSend(title, body)`: `execFile("osascript", ["-e", 'display notification … with title …'])` with both strings escaped for AppleScript (quotes, backslashes); errors logged once, never thrown.

- [ ] **Step 1: failing tests** — same list twice → one send; state change for the same session → a second send; `turn-done` with default settings → no send, with `notifyTurnDone` → send; `notify:false` → none; an AppleScript-escape test for a town name containing `"` and `\`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual, synthetic only: start a second server on port 5199 with `--claude <scratch>/claude --codex <scratch>/codex --no-cache`, append a synthetic session with an open `Bash` call to the scratch root, wait 25 s → exactly one macOS notification. Note the result in the ledger.
- [ ] **Step 6:** Commit `feat(server): macOS notifications for sessions that need you`.

### Task 5: Hook installer

**Files:**
- Create: `packages/server/src/hooks.ts`
- Modify: `packages/server/src/http.ts` (`POST /api/hooks {agent:"claude"|"codex", on:boolean}` → `{ on, added: string[], backup?: string }`)
- Modify: `docs/log-formats.md` (what each hook sends)
- Test: `tests/hooks.test.ts`

**Interfaces:**
- Produces: `HOOK_MARKER = "agent-town-hook"`; `hookCommand(src: "claude"|"codex"): string` — `curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- "http://127.0.0.1:$(cat ~/.agent-town/port 2>/dev/null || echo 5182)/api/hook?src=<src>" >/dev/null 2>&1 || true  # agent-town-hook`; `installClaudeHooks(file): { added: string[]; backup: string | null }`; `uninstallClaudeHooks(file): { removed: number }`; `claudeHooksInstalled(file): boolean`; Codex equivalents only if Step 1 finds an approval or turn-end hook.

- [ ] **Step 1: verify the hook formats** from the official docs (Claude Code hooks: `Notification` and `Stop` events, their stdin JSON, the settings.json `hooks` shape; Codex 0.154 `hooks` feature: its config file, events, stdin). Write what was found, with the doc URLs, into `docs/log-formats.md`. If Codex offers no approval/turn-end event: Ruling — Codex uses the log guess only; the Codex switch is not shown.
- [ ] **Step 2: failing tests** (temp files only): install into a missing file → creates it with only our entries, no backup; install into a file with other hooks for `Notification` → both present, backup `settings.json.agent-town.bak` byte-equal to the original; install twice → no duplicate; uninstall → parsed JSON deep-equals the original; an existing `.bak` is kept (new backup gets a timestamp suffix); invalid JSON → throws, file untouched.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `feat(server): optional precise hooks with backup and undo`.

### Task 6: The page — live updates, 需要你, rings, settings, resume

**Files:**
- Modify: `packages/web/src/data.ts` (`subscribe`), `packages/web/src/store.ts` (`attention`, `reload(p)` that keeps view state), `packages/web/src/App.tsx`
- Create: `packages/web/src/ui/NeedsYou.tsx`, `packages/web/src/ui/Settings.tsx`, `packages/schema/src/resume.ts`
- Modify: `packages/web/src/galaxy/Galaxy.tsx` (`PlanetView`: pulsing ring when its town is in the list), `packages/web/src/v3/Cards25.tsx` (diary button), `packages/server/src/payload.ts` (send `cwd` per request row: `RequestRow.cwd?`), `packages/web/src/styles.css`
- Test: `tests/resume.test.ts`, `tests/store-reload.test.ts`, `packages/web/e2e/attention.spec.ts`

**Interfaces:**
- Consumes: `Attention` (Task 2), `/api/stream`, `/api/settings`, `/api/hooks`.
- Produces: `subscribe(on: { world(): void; attention(a: Attention[]): void }): () => void` (EventSource with reconnect; no-op in demo); store `attention: Attention[]`, `setAttention(a)`, `reload(p: WorldPayload)`; `resumeCommand(faction, sessionId, cwd?): string` with POSIX single-quote escaping; test hook `__agentTown.setAttention(list)`.

- [ ] **Step 1: failing tests** — `resumeCommand("claude-code","abc","/a b/c'd")` → `cd '/a b/c'\''d' && claude --resume abc`; codex → `codex resume abc` (with `cd …` when cwd given); no cwd → no `cd`. Store: `load(p1)`, set focus/city/selected/replay, `reload(p2)` (p2 = p1 plus one request) → all four kept and the new request present.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement data/store/resume. **Step 4:** Run → PASS.
- [ ] **Step 5:** UI: `NeedsYou` (top centre, hidden when empty; row = faction badge, town name, state text, "N 秒前", "复制恢复命令"; click → `focus(town)` + select the request); ring in `PlanetView`; `Settings` (gear button; switches `notify`, `notifyTurnDone`, hook switches with the "will change ~/.claude/settings.json, backup kept" line and the result list after toggling); diary button. Toast "已复制".
- [ ] **Step 6: e2e** `attention.spec.ts` on demo: `setAttention([{…maybe-waiting for the first town}])` → list visible with "可能在等你授权"; click → focus is that town; empty list → hidden; "复制恢复命令" → clipboard (grant permission in the context) contains `--resume`. Run `node --run e2e -- attention --workers=1` → PASS.
- [ ] **Step 7:** `tsc`, `node --run test` → PASS. Build, look at the real page at 5182 with a live session (headless Metal screenshot to the scratchpad, not the repo). Commit `feat(web): 需要你 list, planet rings, settings, resume command`.

### Task 7: The share mask

**Files:**
- Create: `packages/schema/src/share.ts`
- Test: `tests/share.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ShareOptions { secret: string; realNames: boolean; replays: { requestId: string; events: AgentTownEvent[] }[] }
  export function codeName(townKey: string, secret: string): string;   // HMAC-SHA256 → "Kepler-7c" style, stable
  export function shareId(key: string, secret: string): string;        // opaque id replacing town keys / request ids
  export function sharePayload(p: WorldPayload, o: ShareOptions): WorldPayload; // source "share"
  export function maskedTitle(r: RequestRow): string;                  // "完成作品 · 12 步" / "调查 · 30 次调用" / "问答"
  ```
  Town keys and request ids become `shareId`s, so the share page's arrangement of planets and cities is generated from those ids and differs from the owner's own view (the layout hashes the key; keeping it would need the real key). Built by allowlist: request rows keep `class, productKind, tokens, calls, fails, spawns, turns, startTs, endTs, ok, faction` + opaque ids; towns keep kind/theme/counts + opaque key + `codeName` as name; replay events keep only `id, ts, faction, kind, agentId (opaque), parentAgentId (opaque), role, tool (name only), status, durationMs, taskId (opaque), tokens, agentType`. `realNames:true` keeps town names and titles (still no paths, cwd, session ids, raw). `events` (live) and `buildingRows` reduced likewise. Add `"share"` to `WorldPayload.source`.

- [ ] **Step 1: failing tests** — marker test: build a payload from `demoPayload()`, overwrite every string field reachable in it (deep walk) that is not an enum value with `"SECRET-" + i`, run `sharePayload(realNames:false)` → `JSON.stringify` contains no `"SECRET-"` and no `/Users/`; `codeName` stable for same secret, different for another secret; `realNames:true` keeps a town's name but still no `/Users/`; replay events have no `target`, `files`, `title`, `raw`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`node:crypto` is not available in the browser — `share.ts` is used by the server only; the page never needs the secret). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(schema): allowlisted share payload with code names`.

### Task 8: Share mode in the page — names and neutral emblems

**Files:**
- Modify: `packages/web/src/store.ts` (`share: boolean`, `setShare`), `packages/web/src/galaxy/emblem.ts` (neutral marks restored from `git show 4c28b57:packages/web/src/galaxy/emblem.ts`: sunburst / three rings), `packages/web/src/galaxy/Galaxy.tsx` (`Emblem` picks neutral when `share`), `packages/web/src/galaxy/GalaxyApp.tsx` (`Badge`, labels, cards), `packages/web/src/city/CityLabels.tsx`, `packages/web/src/v3/Cards25.tsx`
- Create: `packages/web/src/share/display.ts`
- Test: `packages/web/e2e/share.spec.ts`

**Interfaces:**
- Produces: `townLabel(town, share): string` and `requestLabel(r, share): string` (share → code name / `maskedTitle`); every visible name in labels, cards, hover cards, list rows goes through them. In share mode the diary is closed and cannot open. The page computes code names for recording from a `GET /api/share/names` map (server holds the secret; returns `{ [townKey]: codeName }`); in demo, a local stand-in.
- [ ] **Step 1: e2e failing** — demo, `__agentTown.setShare(true)`: no element text contains any demo town name or request title; emblems: `__galaxyEmblems()` (new test hook) reports `"neutral"`; `setShare(false)` → names back.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `tsc`; `node --run test`.
- [ ] **Step 5:** Commit `feat(web): share mode — code names and neutral emblems`.

### Task 9: Replay recorder

**Files:**
- Create: `packages/web/src/share/recorder.ts`, `packages/web/src/share/RecordDialog.tsx`
- Modify: `packages/web/src/galaxy/GalaxyApp.tsx` (`ReplayBar` gets "录制"; banner), `packages/web/src/city/City.tsx` (mount the compositor frame hook), `packages/web/package.json` (add `gifenc`)
- Test: `tests/recorder.test.ts` (pure helpers), `packages/web/e2e/record.spec.ts`

**Interfaces:**
- Consumes: share mode (Task 8), `useReplay` restart (`cityReplay.ts`).
- Produces: `pickMime(isSupported: (m: string) => boolean): { mime: string; ext: "mp4" | "webm" }` (prefers `video/mp4;codecs=avc1`); `drawLabels(ctx, root: HTMLElement, canvasRect: DOMRect, scale: number)` — draws every visible element with `data-rec` (planet/town labels, `.g-tag`, robot bubbles) at its rect, same font/colour/background; `useCompositor(active)` — `useFrame(cb, 2)` so it runs after the composer's render in the same tick, then `drawImage(gl.domElement)` + `drawLabels` + watermark onto an offscreen 2D canvas whose `captureStream(30)` feeds `MediaRecorder`; `startRecording({ format: "mp4"|"gif", maxMs: 60_000 }): { stop(): Promise<Blob> }`; GIF: every 3rd frame at half size into `gifenc`.
- [ ] **Step 1: failing tests** — `pickMime` with only webm supported → webm; with mp4 → mp4; `fileName("Kepler-7c", date)` → `agent-town-Kepler-7c-2026-11-01.mp4`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement recorder + dialog (dialog: "显示真实名称" off by default, MP4/GIF; on start: `setShare(!realNames)`, banner outside the canvas, restart replay; on stop/end/60 s: download via an `<a download>`, `setShare(false)`).
- [ ] **Step 4: e2e** — demo city replay, record 3 s via the dialog, intercept the download → size > 10 kB, extension mp4 or webm. Run → PASS.
- [ ] **Step 5: look at it.** Save one recording from the demo to `~/Desktop/agent-town-v3/分享/`, extract frames with `ffmpeg -i … -vf fps=1 frame%02d.png` in the scratchpad, open 2–3 frames: labels present and placed on their objects, neutral emblems, no real names. Fix before committing if not.
- [ ] **Step 6:** Commit `feat(web): record a city replay as MP4/GIF`.

### Task 10: The share page

**Files:**
- Create: `packages/server/src/exportShare.ts`, `packages/web/src/share/ExportDialog.tsx`
- Modify: `packages/web/src/data.ts` (load from an embedded `<script type="application/json" id="agent-town-share">` when present), `packages/web/src/main.tsx` / `App.tsx` (viewer mode: no stream, no settings, no diary, no export), `packages/web/src/city/kit.tsx` + `packages/web/src/galaxy/emblem.ts` (model URLs come from `modelUrl(name)`, which returns an embedded data URL in viewer mode), `packages/server/src/http.ts` (`POST /api/export/share {realNames, replays: string[]}` → `text/html` attachment, or 413 with the largest parts named; `GET /api/share/names`), `scripts/serve.ts` (secret in `~/.agent-town/share-secret`, created once, mode 600)
- Test: `tests/exportShare.test.ts`, `packages/web/e2e/sharepage.spec.ts`

**Interfaces:**
- Consumes: `sharePayload` (Task 7), share mode (Task 8).
- Produces: `buildShareHtml(dist: string, payload: WorldPayload, models: Record<string, Buffer>): string` — inlines the single JS chunk and CSS from `dist/index.html`, the three `.glb` as base64 in a JSON map, and the payload; escapes `</script` in embedded JSON. `shareSize(html)` used for the 15/40 MB rule. More than one JS chunk in `dist/assets` → throws with a clear message (the build is a single chunk today).
- [ ] **Step 1: failing tests** — on a temp fake `dist` (tiny index.html + one js + one css) and a demo-based payload: output contains no `<script src=` / `<link href=` to local files; contains the payload JSON; a payload string containing `</script>` is escaped; two JS chunks → throws; a 41 MB payload → the HTTP route answers 413.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement exporter, viewer mode, `modelUrl`, dialog (in space view: "导出分享页"; "显示真实名称" off; up to 5 requests picked from the diary's recent list; size shown; download).
- [ ] **Step 4:** Run unit tests → PASS. **Step 5: e2e** — export from the demo world through the server test harness (fake load = demo events), write the file to the test's temp dir, open it as `file://` with `page.route("**", r => r.request().url().startsWith("file:") ? r.continue() : r.abort())` → canvas bright share > threshold, a planet label visible, entering a city works, no console errors, no demo town name in the DOM. Run → PASS.
- [ ] **Step 6: look at it.** Export from the real world (names hidden) to `~/Desktop/agent-town-v3/分享/`, open it headless, screenshot space + a city, read the screenshots, report the file size.
- [ ] **Step 7:** Commit `feat: export the world as a self-contained share page`.

### Task 11: Records and hand-off

**Files:**
- Modify: `docs/decisions.md` (D22: attention + sharing, with the rulings), `README` if it lists features
- [ ] **Step 1:** Full suite: `node --run test`, `tsc`, `node --run e2e -- --workers=1`; perf check: headless Metal at DPR 1 and 2, space view with the watcher running ≥ 58 fps (as in D20).
- [ ] **Step 2:** Write D22. Commit `docs: D22 attention and sharing`.
- [ ] **Step 3:** Final whole-branch review (one reviewer, most capable model), fix pass per executing-plans.
