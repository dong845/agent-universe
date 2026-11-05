# Cute agents, first run, new features, English — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "大头" character with expressions and subagent props, a guided first run, follow/mini
window/poster/sounds, and an English interface.

**Architecture:** One shared character description (`art/character.json`) feeds the Blender model
script and a 2D SVG face. Every new behaviour that can be a pure function is one (face/prop choice,
agent facts, search, review stats, milestones, chime limiter, gist formatting) and is unit-tested; the
React/three.js parts call them and are checked by e2e and by looking at headless screenshots.

**Tech Stack:** React 19, R3F 9, drei, three 0.186, zustand, Vite 8, Vitest, Playwright (system Chrome),
Blender 5.2 (`/Applications/Blender.app/Contents/MacOS/Blender -b -P`), Node 22.18+ type stripping.

**Spec:** `docs/superpowers/specs/2026-11-05-cute-agents-and-first-run-design.md`

## Global Constraints

- Server, schema and adapter code runs under plain Node type stripping: no parameter properties, no
  enums, no namespaces (`tests/node-strip.test.ts` guards it).
- Real logs, cache and real-data screenshots never go into git, tests or fixtures; screenshots of real
  data stay in the scratchpad. Subagents must not read `~/.claude/projects`, `~/.codex`, `~/.agent-town`,
  `~/Desktop`, nor call `127.0.0.1:5182`.
- No headed browser windows: real-GPU looks use headless Chrome with `--use-angle=metal`.
- Share mode / exports: never request titles (unless the titles switch is on), never gists, paths,
  session ids, cwd. Project names follow the `townNames` switch.
- Internal names keep `agent-town` (data folder, hook marker, cache); user-facing name is Agent Universe.
- Stage named paths only; never `git add -A`; commit locally, never push.
- Model files: `scripts/models/robot.py` → `packages/web/public/models/robot.glb` (committed).

## Review Focus

1. A subagent with no actions yet, or only `spawn`/`compaction` actions → backpack prop, never a crash.
2. Following an agent that vanishes (subagent returns, history step changes, city left) → following
   stops cleanly, the card closes, camera stays where it is.
3. Share mode with the follow card / poster / mini window → no target, title, path or session id.
4. A browser without Document Picture-in-Picture (Firefox/Safari, the share page) → no mini-window
   button, no error.
5. Language switch while panels are open, and old cached worlds whose `gist` is still a string → page
   shows the string as is, never `[object Object]` or a crash.

---

## Phase A — the character

### Task 1: Character description, face and prop rules

**Files:**
- Create: `art/character.json`, `packages/web/src/character/rules.ts`
- Test: `tests/character.test.ts`

**Interfaces:**
- Produces:
  - `art/character.json`: `{ "colors": { "shell", "face", "ink", "blush", "claude", "codex" }, "head": {w,h,d,bevel}, "screen": {w,h,bevel}, "faces": { "<Face>": { "eyes": {shape: "round"|"flat"|"arc"|"line"|"x"|"wide", w, h, dx, dy}, "mouth": {shape: "smile"|"o"|"flat"|"none", w}, "red"?: true } }, "props": { "<Role>": "<prop name>" } }`
  - `type Face = "normal" | "focus" | "think" | "wide" | "error" | "happy" | "sleepy"`
  - `faceOf(s: { pose: Pose; done: boolean; idleMs: number }): Face` — table in the spec (A3); `idleMs ≥ 60000` and not done → `sleepy`.
  - `type Prop = "magnifier" | "pencil" | "hardhat" | "glasses" | "dish" | "clipboard" | "beret" | "goggles" | "bowtie" | "shield" | "backpack"`
  - `propOf(actor: Actor, t: number): Prop | null` — `null` for a main agent; `baseRole` ≠ commander → its prop; else the most-used `outfit` among `actions` with `start ≤ t`, ignoring `commander`/`spawn`/`compaction`, ties → earliest first use; none → `backpack`.
  - `ROLE_PROP: Record<Role, Prop>` read from `character.json`.

- [ ] **Step 1: Write the failing tests** — `faceOf`: every pose in the A3 table maps as listed; `done` beats pose except error poses; `idleMs 59999 → normal`, `60000 → sleepy`, done + idle → happy. `propOf`: main → null; `baseRole: "scout"` → magnifier; commander sub with actions [smith, smith, scout] → pencil; tie [scout, smith] → magnifier; actions only after `t` → backpack; only `spawn` actions → backpack. `character.json` has a face entry for every `Face` and a prop for every non-commander `Role`.
- [ ] **Step 2: Run** `node --run test -- character` → FAIL (module missing).
- [ ] **Step 3: Implement** `rules.ts` (imports `character.json` with `with { type: "json" }` as other config reads do; check how `config/roles.json` is loaded and match it).
- [ ] **Step 4: Run** `node --run test -- character` → PASS.
- [ ] **Step 5: Commit** `art/character.json packages/web/src/character/rules.ts tests/character.test.ts`.

### Task 2: The Blender model

**Files:**
- Modify (rewrite): `scripts/models/robot.py`; regenerate `packages/web/public/models/robot.glb`
- Delete: `scripts/models/robot_concept.py` (after this task)
- Test: `tests/robot-model.test.ts`

**Interfaces:**
- Consumes: `art/character.json` (sizes, face shapes, colours).
- Produces: GLB nodes `Robot > Body > {Head > {Face_<Face> ×7, Antenna, PhonesL, PhonesR, PropHead_<prop>…}, ArmL > {PropHand_<prop>…}, ArmR, FootL, FootR, Chest}`. Head props: hardhat, glasses, beret, goggles; hand props: magnifier, pencil, dish, clipboard, shield; body: bowtie, backpack (`PropBody_<prop>`). Materials: `Shell`, `Screen`, `Ink`, `Eye` (faction, recoloured), `Phones` (recoloured), `Chest` (recoloured), `Blush`, `Red`, plus prop materials. Faces: every `Face_*` mesh hidden except `Face_normal` in the file.

- [ ] **Step 1: Write the failing test** — parse the GLB's JSON chunk (no three.js needed: 12-byte header, chunk 0 JSON) and assert every node name above exists, each `Face_*` and each `Prop*_<prop>` for every `Prop` in `character.json`; total triangles < 60 000 (sum of index counts / 3 from accessors).
- [ ] **Step 2: Run** → FAIL (old model lacks the nodes).
- [ ] **Step 3: Rewrite `robot.py`** starting from `chibi()` in `robot_concept.py`; proportions from the concept image (head ≈ 55 % of height); faces built from `character.json`; props simple, chunky and readable at 30 px. Add `--preview <dir>` writing one PNG per face and one per prop (AgX view, three-quarter camera) to the given folder.
- [ ] **Step 4: Build and look** — `Blender -b -P scripts/models/robot.py -- packages/web/public/models/robot.glb --preview <scratchpad>/robot`; open every preview PNG and check: cute at a glance, eyes clearly the faction colour, each prop recognisable. Fix and rebuild until it is.
- [ ] **Step 5: Run** `node --run test -- robot-model` → PASS; delete `robot_concept.py`.
- [ ] **Step 6: Commit** `scripts/models/robot.py packages/web/public/models/robot.glb tests/robot-model.test.ts` and the deletion.

### Task 3: Robot in the city — colours, faces, blink, props, size

**Files:**
- Modify: `packages/web/src/city/Robot.tsx`, `packages/web/src/city/City.tsx` (lane offsets only if clipping), `packages/web/src/city/HistoryPanel.tsx` (standing agents spacing), `packages/web/src/city/CityLabels.tsx` (bubble anchor height)
- Test: `packages/web/e2e/agents.spec.ts`

**Interfaces:**
- Consumes: `faceOf`, `propOf`, `ROLE_PROP` (Task 1); GLB nodes (Task 2).
- Produces: test hook `window.__robotSizes(): { id: string; kind: "main" | "sub"; px: number }[]` (projected screen height of each visible robot's bounding box); `robotInfo` entries gain `face: Face` and `prop: Prop | null` (used by Tasks 9, 10, 11).

- [ ] **Step 1: Write the failing e2e** — demo world, enter the biggest live town (`__galaxyLive[0]`), wait 3 s: every main ≥ 40 px, every sub ≥ 28 px; `__robotSizes` non-empty.
- [ ] **Step 2: Run** `node --run e2e -- agents` → FAIL (hook missing / too small).
- [ ] **Step 3: Implement** — recolour by material name (Eye/antenna tip = faction, Phones = faction or `WORK_COLOR[role]`, Chest = `WORK_COLOR[outfit]`); per frame set exactly one `Face_*` visible from `faceOf` (idle time = scene time since the last non-idle pose), blink by scaling `Face_normal` Y to 0.1 for 120 ms every 3–5 s (per-robot phase from id); show only the `propOf` prop; feet bob when walking; keep the existing pose animation; raise `SCALE` until the size floor holds; keep the emblem over the main agent. If robots clip into buildings at work lanes, move lane/door offsets first, then the default camera.
- [ ] **Step 4: Run** the e2e → PASS; take a headless Metal screenshot of a real-data city (scratchpad) and look at it.
- [ ] **Step 5: Commit** touched files.

### Task 4: The 2D face

**Files:**
- Create: `packages/web/src/character/Face2D.tsx`
- Test: `tests/face2d.test.ts`

**Interfaces:**
- Produces: `<Face2D face={Face} faction={Faction} accent?={string} prop?={Prop | null} size={number} />` — inline SVG from `character.json` (head, screen, eyes/mouth per face, headphones, a small prop glyph).

- [ ] **Step 1: Failing test** — `renderToStaticMarkup` of each face: contains `<svg`, the faction colour on the eyes, red only for `error`, an `<path`/`<circle` set that differs between `normal` and `happy`; the prop glyph present iff `prop` given.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

## Phase D1 — the dictionary

### Task 5: i18n core

**Files:**
- Create: `packages/web/src/i18n/index.ts`, `packages/web/src/i18n/zh.ts`, `packages/web/src/i18n/en.ts`
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Produces: `type Lang = "zh" | "en"`; `detectLang(navLangs: readonly string[]): Lang` (first `zh*` → zh, else en); `t(key: Key, vars?: Record<string, string | number>): string` using the current language, `{name}` placeholders; `useLang(): Lang` (zustand store, re-renders on change); `setLang(l: Lang)` (saved in localStorage `agent-universe:lang`, wrapped in try/catch); `type Key = keyof typeof zh`; `en` typed `Record<Key, string>` so a missing English key is a type error.

- [ ] **Step 1: Failing test** — `detectLang(["zh-CN"])` zh, `(["en-US","zh"])` en, `([])` en; `t` fills vars; switching language changes `t`'s output; every `zh` key exists in `en` and vice versa (runtime check too).
- [ ] **Step 2–4:** run FAIL → implement → PASS. New strings from Task 6 on go through `t()`.
- [ ] **Step 5: Commit.**

### Task 6: Gist as facts

**Files:**
- Modify: `packages/schema/src/requests.ts` (`gistOf`), `packages/schema/src/` type of `RequestRow.gist`, `packages/web/src/city/history.ts` (`stepFacts`), `packages/server/src/load.ts` (`CACHE_VERSION` only if requests are cached — check first)
- Create: `packages/web/src/i18n/gist.ts`
- Test: `tests/requests.test.ts` (update), `tests/history.test.ts` (update), `tests/i18n.test.ts` (add)

**Interfaces:**
- Produces: `type GistFacts = { kind: "edit"; n: number; files: string[] } | { kind: "run"; command: string } | { kind: "web"; query: string } | { kind: "read"; n: number } | { kind: "calls"; n: number }`; `RequestRow.gist?: GistFacts`; `formatGist(g: GistFacts | string, lang: Lang): string` (a string — an old cached world — is returned unchanged).

- [ ] **Step 1: Update tests** — `requests.test.ts` expects facts objects for the same fixtures that today produce "改了 N 个文件：…" etc.; `formatGist` zh output equals today's strings exactly; en: "Edited 3 files: a.ts, b.ts…", "Ran: git status", "Web: …", "Read 12 files", "12 tool calls"; string input passes through. `sharePayload` still never includes `gist` (existing test stays green).
- [ ] **Step 2–4:** FAIL → implement → PASS (`node --run test`).
- [ ] **Step 5: Commit.**

## Phase B — first run

### Task 7: Tidier city, the empty-logs card, no dead stat

**Files:**
- Modify: `packages/web/src/galaxy/GalaxyApp.tsx` (`CityLegend`, the `demo-badge` empty-logs text → new `EmptyLogsCard`), `packages/web/src/ui/Chrome.tsx`, `packages/web/src/ui/HoverCard.tsx`, `packages/web/src/ui/Diary.tsx`, `packages/web/src/styles.css` (or wherever `.demo-badge` lives)
- Test: `packages/web/e2e/firstrun.spec.ts` (extend)

**Interfaces:**
- Produces: `CityLegend` initial state from localStorage `agent-universe:city-legend` (default closed); `EmptyLogsCard` (`data-testid="empty-logs"`, closable, `data-testid="empty-logs-close"`).

- [ ] **Step 1: Failing e2e** — empty-logs page: `empty-logs` box does not intersect the HUD box nor `legend` nor the shell meter; closing it hides it; no text "等效花费" anywhere in the DOM (space, hover card, diary, city); entering a city shows the legend collapsed; opening it, leaving and re-entering keeps it open.
- [ ] **Step 2–4:** FAIL → implement (strings via `t()`) → PASS.
- [ ] **Step 5: Commit.**

### Task 8: Search

**Files:**
- Create: `packages/web/src/galaxy/search.ts`, `packages/web/src/ui/Search.tsx`
- Modify: `packages/web/src/galaxy/GalaxyApp.tsx` (mount it in space view)
- Test: `tests/search.test.ts`, `packages/web/e2e/search.spec.ts`

**Interfaces:**
- Produces: `searchTowns(towns: { key: string; name: string }[], q: string, limit = 8): { key: string; name: string }[]` — case-insensitive; prefix matches first, then word-start, then substring; empty query → `[]`. In share mode the names passed are the shown names.

- [ ] **Step 1: Failing tests** — ranking (prefix > word-start > substring), case-insensitive, CJK substring, limit, empty query. e2e: `/` focuses the box; typing a demo town name lists it; Enter → `__agentTown.state().focus` is its key; Enter again → city entered; Esc clears.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit.**

### Task 9: Guided tour

**Files:**
- Modify (rewrite): `packages/web/src/ui/Tour.tsx`
- Create: `packages/web/src/ui/tourStore.ts`, `packages/web/src/galaxy/TourHighlight.tsx` (3D ring + planet pulse)
- Modify: `GalaxyApp.tsx` (mount highlight in both scenes), `Settings.tsx` ("重新看导览"), `Galaxy.tsx` (pulse while `invite`)
- Test: `tests/tour.test.ts`, `packages/web/e2e/firstrun.spec.ts` (extend)

**Interfaces:**
- Produces: `tourSteps(ctx: { source: "real" | "demo" | "share"; biggest: string | null; hasRobot: boolean }): TourStep[]`, `TourStep = { id: "welcome" | "stars" | "planet" | "city" | "robot" | "panels" | "invite"; text: Key; go: Go; highlight: { kind: "star" | "planet" | "robot" | "dom"; key?: string; testid?: string } | null }` where `Go = "overview" | "focus" | "enter" | "follow" | "leave"`; `useTour` store `{ step: number | -1; invite: boolean; start(); next(); prev(); skip() }`; done saved in `agent-universe:tour-done`.

- [ ] **Step 1: Failing tests** — unit: demo source → welcome text key is the demo one; no biggest planet → planet/city/robot steps dropped; 7 steps otherwise in the spec's order; `hasRobot: false` keeps the robot step (it uses history agents). e2e (demo): each `next` changes the camera target or view (`__agentTown.state().focus/city`); step "robot" makes `followAgent` non-null; last step leaves the city, `invite` true; the first planet click sets `invite` false; skip at step 1 leaves done = true; settings "重新看导览" restarts at step 1.
- [ ] **Step 2–4:** FAIL → implement → PASS. Card placement: beside the highlight, never over the screen centre.
- [ ] **Step 5: Commit.**

## Phase C — new features

### Task 10: Follow an agent

**Files:**
- Create: `packages/web/src/city/agentFacts.ts`, `packages/web/src/city/FollowCard.tsx`
- Modify: `packages/web/src/store.ts` (`followAgent: string | null; setFollowAgent(id)`), `Robot.tsx` (click proxy: an invisible sphere that raycasts; the model keeps `noRay`), `City.tsx` (`CityCamera` follows `followAgent` with the existing replay-follow code generalised; drag/Esc/city change clears), `GalaxyApp.tsx` (mount card)
- Test: `tests/agentFacts.test.ts`, `packages/web/e2e/follow.spec.ts`

**Interfaces:**
- Consumes: `robotInfo` (`face`, `prop`), `Face2D`.
- Produces: `agentFacts(events: AgentTownEvent[], agentId: string, t: number, opts: { share: boolean; titles: boolean }): { kind: "main" | "sub"; agentType?: string; task?: string; doing: { role: Role; tool?: string; target?: string } | null; sinceMs: number; tokens: number; children: string[]; parent?: string }` — `doing` is the latest `tool_start` at or before `t` without its `tool_end` (else null); `target` only when not share; `task` only when not share or titles; `tokens` = sum of `model_call` tokens (input+output+cacheRead+cacheWrite) for the agent up to `t`; children = agents whose `parentAgentId` is this one and that spawned by `t`.

- [ ] **Step 1: Failing tests** — unit: open tool → doing with tool/target; closed → null; share hides target and (titles off) task; tokens sum up to `t` only; children only spawned by `t`; unknown agent → kind sub with zeros (no throw). e2e (demo live town): click a robot (via `__agentTown.clickRobot(id)` hook that dispatches the same handler) → card visible, camera target within 1 unit of the robot after 2 s; Esc → card gone; share mode → card shows no `/` path characters from targets.
- [ ] **Step 2–4:** FAIL → implement → PASS. Following a robot that disappears clears `followAgent`.
- [ ] **Step 5: Commit.**

### Task 11: Mini window

**Files:**
- Create: `packages/web/src/ui/miniRows.ts`, `packages/web/src/ui/MiniWindow.tsx`
- Modify: `GalaxyApp.tsx` (button in the top bar when supported and source ≠ share), `NeedsYou.tsx` (each row starts with a `Face2D`: `wide` waiting, `error` error, `happy` turn done)
- Test: `tests/miniRows.test.ts`, `packages/web/e2e/mini.spec.ts`

**Interfaces:**
- Produces: `miniRows(input: { w: World25; attention: Attention[]; closed: Record<string, string>; now: number; names: (key: string) => string }): { attention: MiniRow[]; live: MiniRow[] }` with `MiniRow = { key: string; town: string; faction: Faction; face: Face; doing: string; sinceMs: number; attention?: Attention }`; `<MiniWindow />` opens `documentPictureInPicture.requestWindow({ width: 320, height: 420 })` on click, copies the page's stylesheets into it, renders rows with `createPortal`, "回到页面" calls `window.focus()`.

- [ ] **Step 1: Failing tests** — unit: attention rows first, closed ones dropped, live rows sorted newest activity first, face `wide` for waiting / `error` for error / `focus` otherwise. e2e: button present iff `"documentPictureInPicture" in window`; click → `documentPictureInPicture.window` not null and contains the row count text.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit.**

### Task 12: Review poster

**Files:**
- Create: `packages/web/src/share/review.ts`, `packages/web/src/share/poster.ts`, `packages/web/src/share/PosterDialog.tsx`
- Modify: `ExportShare` menu (add "回顾海报"), `recorder.ts` only if a one-frame grab helper is missing
- Test: `tests/review.test.ts`, `packages/web/e2e/poster.spec.ts`

**Interfaces:**
- Produces: `type Period = "week" | "month" | "year" | "all"`; `reviewStats(requests: RequestRow[], period: Period, now: number, tz?: string): { from: number; to: number; days: { day: string; n: number }[]; streak: number; requests: number; products: number; tokens: number; busiest?: { key: string; n: number }; work: { role: Role; n: number }[]; subagents: { type: string; n: number }[] }`; `drawPoster(ctx: CanvasRenderingContext2D, s: ReviewStats, opts: { bg: CanvasImageSource | null; lang: Lang; names: (key: string) => string }): string[]` (draws 1080×1350, returns every text it drew; the character's face is the `Face2D` markup drawn through an `Image` from an SVG data URL).

- [ ] **Step 1: Failing tests** — stats: week = last 7 local days ending today; streak counts consecutive active days ending today or yesterday; empty period → zeros, no busiest; busiest ties → most tokens. Privacy: with a fixture whose titles/gists/cwd contain marker strings, `drawPoster` (on an `OffscreenCanvas`-like stub ctx recording `fillText`) returns no marker; names hidden switch → code names. e2e (demo): open dialog, pick week, download → PNG 1080×1350 (read IHDR), name `agent-universe-review-week-<date>.png`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Look at one rendered poster (scratchpad) before committing.
- [ ] **Step 5: Commit.**

### Task 13: Sounds and celebrations

**Files:**
- Create: `packages/web/src/ui/sounds.ts`, `packages/web/src/ui/milestones.ts`, `packages/web/src/galaxy/Celebration.tsx`
- Modify: `Settings.tsx` (sound switch, page-side, localStorage `agent-universe:sounds`), `main.tsx` or the attention subscriber (trigger), `GalaxyApp.tsx` (mount celebration + toast)
- Test: `tests/sounds.test.ts`, `tests/milestones.test.ts`

**Interfaces:**
- Produces: `makeChimer(play: (kind: "done" | "waiting") => void, minGapMs = 3000): (kind, now: number) => boolean`; `attentionSounds(prev: Attention[], next: Attention[]): ("done" | "waiting")[]` (new waiting/maybe-waiting → waiting; new turn-done → done); `type Milestone = { id: string; kind: "products" | "shell" | "first"; n?: number; where: string }`; `newMilestones(prev: Counts | null, next: Counts, seen: Set<string>): Milestone[]` — `prev === null` (first load) → `[]`; thresholds 10/50/100/250/500/1000 products, each 10 % of a shell, a project's first product; never one in `seen`.

- [ ] **Step 1: Failing tests** — chimer: second call within 3 s → false; off switch → `play` never called. `attentionSounds`: unchanged list → []; new waiting → ["waiting"]. milestones: first load → []; 99→100 → products 100; 95→260 → 100 and 250; seen → []; shell 9 %→21 % → 10 % and 20 %; new project's first product → first.
- [ ] **Step 2–4:** FAIL → implement (Web Audio: two short sine notes with an envelope, gain ≤ 0.08) → PASS.
- [ ] **Step 5: Commit.**

## Phase D2 — English everywhere

### Task 14: All strings through the dictionary; server and terminal languages; README.zh

**Files:**
- Modify: every file under `packages/web/src` with Chinese text (30 today); `Settings.tsx` (language switch); `packages/server/src/settings.ts` + `http.ts` (`lang` setting), `packages/server/src/notify.ts` (texts per lang), `scripts/start.mjs`, `scripts/serve.ts` (messages by `LANG`)
- Create: `README.zh.md`; link from `README.md`
- Test: `tests/no-cjk.test.ts`, `tests/notify.test.ts` (extend), `tests/start.test.ts` (extend), `tests/http.test.ts` (extend)

**Interfaces:**
- Produces: `/api/settings` accepts and returns `lang: "zh" | "en"` (default from `LANG`); `notifyText(kind, town, lang)`; `msg(key, lang)` in `start.mjs` with `langOf(env = process.env): Lang`.

- [ ] **Step 1: Failing tests** — `no-cjk`: no CJK character in `packages/web/src/**` outside `i18n/zh.ts` and comments (strip `//` and `/* */` first); notify: en text for en; start: `langOf({LANG:"zh_CN.UTF-8"})` zh, `({})` en; http: POST lang persists.
- [ ] **Step 2–4:** FAIL → convert → PASS. Language switch re-renders open panels.
- [ ] **Step 5: Look** — headless screenshots of space, city, history, settings in English (demo); read them for clipped or overflowing text.
- [ ] **Step 6: Commit.**

---

## Finish

- [ ] `node --run test` (whole suite) and `node --run e2e` green; `tsc` clean.
- [ ] Real-data look (headless Metal, scratchpad only): space, a live city with followed agent, a history step with standing subagents and props, the poster, English page.
- [ ] Fresh-clone `npm start` check in a temp folder still opens the page.
- [ ] Whole-branch review (sonnet), fix Critical/Important, list minors.
- [ ] `docs/decisions.md` D25 entry; README(s) updated (features list: follow, mini window, poster, sounds, language).
