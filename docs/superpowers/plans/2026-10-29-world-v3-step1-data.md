# World v3 Step 1 — Requests, Skills, Towns, Themes (data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server turns the logs into requests (human turn + its system continuations), classifies each (produced / investigation / chat / empty) with a product kind and the skills it used, places each request in a town by the v3 rules (skill guild, repo with worktrees merged, capital, marked project, outpost), gives each town a kind and a theme, and serves all of it on `/api/world`.

**Architecture:** Adapters gain an untruncated `files` list on tool_start and read the Claude Skill tool's `skill` argument. The demo payload is built in the browser (`packages/mock/src/world.ts`), so everything that does not need the file system is a pure module in `packages/schema/src`: `requests.ts` (folding + rows), `skills.ts` (names), `themes.ts` (keyword pick), `towns.ts` (town rows, with guild detection and descriptions injected). The server adds the file-system parts in `packages/server/src/townsFs.ts` (guild detection, SKILL.md descriptions, local overrides). `assign.ts` keeps its voting but votes per request and uses the v3 placement rules. `compactPayload` adds `requests` and `towns`. The existing frontend keeps working on events (it only sees fewer, better-named towns).

**Tech Stack:** Node 22+ TS (type stripping), Vitest 5, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-world-v3-design.md` (sections 4, 13.4, 13.5, 13.8).

## Global Constraints

- Tests use synthetic logs only (`tests/helpers/synthLogs.ts`) and temp directories; never read `~/.claude/projects`, `~/.codex`, `~/.agent-town`.
- Real-data checks print aggregates only (counts, never titles/paths/prompts).
- D5: after the adapter change, `node scripts/parse.ts --against <fresh probes>` must report 100% agreement.
- Commit locally after each task; never push; stage named paths only; no `git -c`.
- Run tests with `./node_modules/.bin/vitest run <file>`; the full suite with `node --run test`.
- Investigation threshold 20 tool calls; landmark tiers 1/10/40; max streets 6 — all in `config/world.json`.
- Skill descriptions, town names and titles only ever go to the local page; never into git, tests or prompts.
- The server stays loopback-only with the existing Host/Origin checks; the new POST uses them.

## Review Focus

1. A system turn whose session never had a human turn (resumed session, first line is a hand-back) → its own request, not dropped, not merged into another session.
2. A request whose turns touched files in two towns → one town for the whole request (all turns share it), by votes; never split.
3. A skill directory that is a symlink into a repo (`~/.claude/skills/x → ~/code/x`) → the repo town, which is a guild of `x`.
4. Paths clipped with "…" in `target` (long Codex patches) → `files` carries every full path, so product kind and topDir use real extensions.
5. A hidden skill dir (`~/.codex/skills/.system/...`) → not a guild; falls through to the capital.

---

### Task 1: Adapters — untruncated `files`, Claude Skill name

**Files:**
- Modify: `packages/schema/src/event.ts` (add `files`)
- Modify: `packages/adapter-claude/src/index.ts` (`toolTarget`, tool_start push)
- Modify: `packages/adapter-codex/src/index.ts` (apply_patch tool_start)
- Test: `tests/adapters.test.ts`

**Interfaces:**
- Produces: `AgentTownEvent.files?: { path: string; access: "read" | "edit" }[]` on tool_start only, exact sources only (Claude Read → read; Edit/MultiEdit/Write/NotebookEdit → edit; Codex apply_patch Add/Update/Delete headers → edit, relative paths resolved against the session cwd when it is absolute, else left relative). Claude `Skill` tool_start has `target = input.skill`.

- [ ] **Step 1: Write failing tests** in `tests/adapters.test.ts`:
  - `claude tool_start carries the full file path even when the target is clipped`: a Write to a 200-char path → `target` ends with "…", `files` = `[{ path: <full>, access: "edit" }]`; a Read → access `"read"`.
  - `claude Skill tool target is the skill name`: tool `{ name: "Skill", input: { skill: "superpowers:brainstorming", args: "x" } }` → `target === "superpowers:brainstorming"`.
  - `codex apply_patch lists every patched file`: a patch with Add `a/one.ts`, Update a 150-char absolute path, Delete `b/two.md` in cwd `/w` → `files` paths `["/w/a/one.ts", <long>, "/w/b/two.md"]`, all `"edit"`.
  - `tools without files have no files field`: Bash → `files` undefined.
- [ ] **Step 2:** `./node_modules/.bin/vitest run tests/adapters.test.ts` — Expected: the 4 new tests FAIL (files undefined / target undefined).
- [ ] **Step 3: Implement.** Claude: in `toolTarget` add `input.skill` before `file_path` for name `Skill`; compute `files` from `input.file_path`/`notebook_path` with access by tool name. Codex: parse the untruncated patch text with the same header regex as `assign.ts` `PATCH_FILE`.
- [ ] **Step 4:** run the file again — Expected: PASS; then `node --run test` — Expected: all green.
- [ ] **Step 5: D5 check.** `python3 scripts/probe/probe_claude.py --json=$S/probe-claude.json` and `python3 scripts/probe/probe_codex.py --json=$S/probe-codex.json` (`$S` = scratchpad), then `node scripts/parse.ts --against $S/probe-claude.json,$S/probe-codex.json` — Expected: 100% agreement lines for both factions, no `problems`.
- [ ] **Step 6: Commit** `git add packages/schema/src/event.ts packages/adapter-claude/src/index.ts packages/adapter-codex/src/index.ts tests/adapters.test.ts && git commit -m "feat(adapters): untruncated files on tool_start; Claude Skill name"`

### Task 2: Requests — fold system turns into the human request

**Files:**
- Create: `packages/schema/src/requests.ts`
- Test: `tests/requests.test.ts`

**Interfaces:**
- Produces: `requestIdsOf(events: AgentTownEvent[]): Map<string, string>` — taskId → requestId. A human-triggered task (or one with no `trigger`) is its own request; a `trigger: "system"` task joins the latest human task in the same `faction|sessionId` that started at or before it; with none, it is its own request. Uses task_start ts, independent of array order.

- [ ] **Step 1: Failing tests** `tests/requests.test.ts > requestIdsOf`:
  - system turn after human → same id as the human; two humans then a system → joins the second.
  - system turn first in its session → its own id.
  - same sessionId string in the other faction does not join.
  - events given in reverse order → same map.
- [ ] **Step 2:** run — Expected: FAIL (module missing).
- [ ] **Step 3:** implement in `packages/schema/src/requests.ts` (no node imports).
- [ ] **Step 4:** run — Expected: PASS.
- [ ] **Step 5: Commit** `requests.ts` + test: `feat(server): fold system-opened turns into their request`.

### Task 3: Placement v3 — guild, repo (+worktree), capital, marked project, outpost

**Files:**
- Modify: `packages/server/src/assign.ts`
- Modify: `packages/server/src/projectRoot.ts` (add `mainRepoOf`)
- Modify: `packages/server/src/load.ts` (pass request ids; options default)
- Test: `tests/assign.test.ts` (update), `tests/projectRoot.test.ts`

**Interfaces:**
- Consumes: `requestIdsOf` (Task 2), `e.files` (Task 1; `touchedDirs` prefers `files` over `target`).
- Produces: `OUTPOST = "野外营地"`, `CAPITAL = "都城"`, defined in a new `packages/schema/src/towns.ts` (constants only in this task) and re-exported by `assign.ts` (replace `TEMP_PROJECT`; keep `TEMP_PROJECT` exported as an alias of `OUTPOST` for one release so old imports compile); `AssignOptions { home; tempRoots; toolRoots: string[] }` with `defaultToolRoots(home) = [~/.claude, ~/.codex, ~/.agents]`; `mainRepoOf(root: string): string` — for a worktree (`.git` is a file `gitdir: <main>/.git/worktrees/<n>`) the main repo, else `root`; `assignProjects(events, o)` votes per **request** and writes one town to every event of the request.
- Placement of a touched dir `d` (real path), first match wins:
  1. `d` under `<x>/skills/<name>/` with `name` not starting with "." → if `gitRoot(d)` exists, `mainRepoOf(gitRoot)`; else the skill dir `<x>/skills/<name>`.
  2. `gitRoot(d)` → `mainRepoOf(gitRoot(d))`.
  3. under a temp root → `OUTPOST`; under a tool root → `CAPITAL`.
  4. nearest ancestor of `d` strictly below home with a marker (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `README.md`, `README`) → that ancestor.
  5. else `OUTPOST`.
  - A request with no votes uses its cwd through the same rules; cwd = home → `OUTPOST`; non-absolute cwd stays as it is.
  - Vote precedence unchanged: exact real towns > inferred real towns > exact OUTPOST/CAPITAL > inferred; ties → first touched.

- [ ] **Step 1: Failing tests** (`tests/assign.test.ts`, temp-dir world as today, extended with `x/skills/alpha/SKILL.md`, `.codex/skills/.system/s/SKILL.md`, `code/repoA/.claude/worktrees/w1` with a `.git` file pointing at `code/repoA/.git/worktrees/w1`, `Documents/proj/package.json`, `Downloads/deck/a.pptx`):
  - `a plain skill dir is its own guild town` → `<h>/x/skills/alpha`.
  - `a skill symlinked into a repo belongs to the repo` (existing `tb` symlink) → `<h>/code/tb`.
  - `a worktree's files count for the main repo` → `<h>/code/repoA`.
  - `a hidden skill dir under ~/.codex goes to the capital` → `CAPITAL`.
  - `a folder with a project marker is a town` → `<h>/Documents/proj`.
  - `unmarked folders and temp dirs go to the outpost` → `OUTPOST` for both.
  - `a request with no file votes started in home goes to the outpost`.
  - `every turn of a request lands in the same town`: human turn edits repoA once, its system turn edits repoB twice → all events of both turns in repoB (votes summed over the request).
  - Update existing expectations that used `TEMP_PROJECT` or the old two-levels-under-home container (rule now: marker or outpost) — ledger this as a Ruling.
  - `tests/projectRoot.test.ts > mainRepoOf`: worktree file → main; normal repo → itself; unreadable/garbled `.git` file → itself.
- [ ] **Step 2:** run both files — Expected: new tests FAIL.
- [ ] **Step 3:** implement; `load.ts` calls `assignProjects(events, { …, toolRoots })` and passes `requestIdsOf(events)` (signature `assignProjects(events, o, requestOf?: Map<string,string>)`; without it, each task is its own request, so old callers behave).
- [ ] **Step 4:** run both files, then `node --run test` — Expected: all green.
- [ ] **Step 5: Commit** `feat(server): v3 placement — guilds, worktrees merged, capital, marked projects, outpost; one town per request`.

### Task 4: Skills — names, use per event, descriptions

**Files:**
- Create: `packages/schema/src/skills.ts` (`normSkill`, `skillsOfEvent` — pure) and `packages/server/src/townsFs.ts` (`skillDescription`, `skillDirs` — fs)
- Test: `tests/skills.test.ts`

**Interfaces:**
- Produces:
  - `normSkill(raw: string): { key: string; display: string; plugin?: string }` — strip a `plugin:` prefix into `plugin`, lower-case, `_` → `-`; `display` keeps the original name without prefix.
  - `skillsOfEvent(e: AgentTownEvent): string[]` (keys) — tool_start only: `Skill` tool → `normSkill(target)`; any `files` path or `target`/command text matching `/[\/\\]skills[\/\\]([^\/\\\s"'`]+)[\/\\]SKILL\.md/i` with a name not starting with ".".
  - `skillDescription(dirs: string[]): string | undefined` — first sentence (≤ 120 chars) of the `description:` frontmatter of the first existing `<dir>/SKILL.md`; quoted or plain YAML scalar; undefined if none.
  - `skillDirs(home: string, key: string): string[]` — candidates `~/.claude/skills/<k>`, `~/.codex/skills/<k>`, `~/.agents/skills/<k>` with both `-` and `_` spellings.

- [ ] **Step 1: Failing tests**: prefix + underscore normalisation (`superpowers:brainstorming`, `music_suggester` = `music-suggester`); Skill tool event; Codex `cat ~/.codex/skills/slide-maker/SKILL.md` command; Read of `…/skills/x/SKILL.md` via `files`; hidden `.system` ignored; Bash without skill path → `[]`; description from a temp SKILL.md with quoted multi-sentence description → first sentence; missing file → undefined.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** run — PASS.
- [ ] **Step 5: Commit** `feat(server): skill names from Skill calls and SKILL.md paths; local descriptions`.

### Task 5: Request rows — class, product kind, topDir, totals

**Files:**
- Create: `packages/schema/src/worldConfig.ts` — `WorldConfig` type and `DEFAULT_WORLD_CONFIG`; `config/world.json` holds the same values and the server merges it over the defaults (`loadWorldConfig(path?)` in `packages/server/src/townsFs.ts`). Values: `{ "investigationCalls": 20, "landmarkTiers": [1, 10, 40], "maxStreets": 6, "productExt": { "code": [...], "docs": ["md","txt","rst","tex"], "slides": ["pptx","key"], "image": ["png","jpg","jpeg","svg","webp","gif"], "video": ["mp4","mov","mp3","wav","srt"], "data": ["json","yaml","yml","toml","csv"] } }`
- Modify: `packages/schema/src/requests.ts` (add `buildRequests`)
- Modify: `packages/schema/src/payload.ts` (types)
- Test: `tests/requests.test.ts`

**Interfaces:**
- Produces (in `packages/schema/src/payload.ts`):
  ```ts
  export type RequestClass = "produced" | "investigation" | "chat" | "empty";
  export type ProductKind = "code" | "docs" | "slides" | "image" | "video" | "data";
  export interface RequestRow { requestId: string; faction: Faction; projectId: string; sessionId: string; startTs: number; endTs: number; ok: boolean | null; title?: string; class: RequestClass; productKind: ProductKind | null; tokens: Tokens; calls: number; fails: number; spawns: number; skills: string[]; topDir: string | null; turns: number; taskIds: string[] }
  ```
- `buildRequests(events: AgentTownEvent[], requestOf: Map<string,string>, cfg: WorldConfig): RequestRow[]`.
- Rules: produced = any tool_start with an `edit` file, or a tool name matching `/image_gen|imagegen/`; else investigation if calls ≥ `investigationCalls`; else chat if calls ≥ 1; else empty. productKind (produced only): one vote per edited file occurrence by extension per `productExt` (slides also: html/pdf whose path contains `slides` or `deck`; video also: any path containing `/remotion/`); each image-gen call votes image; unknown or no extension → code; tie → order code, docs, slides, image, video, data. topDir: first path segment, relative to `projectId`, of the most-edited files (ties → first edited); a file directly in the root → `"."`; null for non-absolute projectId (CAPITAL/OUTPOST) or no edits. ok: false if any turn's task_end is error, true if all ended ok, null if any turn has no end. title: the human turn's title. tokens: sum of model_call tokens over all turns (reasoning included where present).
- [ ] **Step 1: Failing tests** `buildRequests`: 19 vs 20 Bash calls → chat vs investigation; zero tools → empty; one Edit → produced; image-gen only → produced/image; kind votes (2 md + 1 ts → docs; 1 md + 1 ts → code by tie order; `deck/out.html` → slides; `a/remotion/Comp.tsx` → video; `Makefile` → code); topDir (`src/a.ts`×2 + `docs/b.md`×1 → `src`; root file → `.`); ok tri-state; token sum over a two-turn request equals the per-turn sum; `taskIds` lists both turns.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** run — PASS.
- [ ] **Step 5: Commit** `feat(server): request rows — class, product kind, top directory, totals`.

### Task 6: Towns and themes

**Files:**
- Create: `config/themes.json` — `{ "themes": [{ "id": "publishing", "name": "出版镇", "keywords": ["slide","deck","ppt","doc","paper","figure","publish"] }, { "id": "film", "name": "影视镇", "keywords": ["video","film","movie","remotion","tok","clip"] }, { "id": "music", "name": "音乐镇", ... }, { "id": "talent", "name": "人才市集", ... }, { "id": "harbor", "name": "港口镇", ... }, { "id": "stargazer", "name": "观星镇", ... }, { "id": "exchange", "name": "交易所", ... }, { "id": "toyworks", "name": "玩具工坊", ... }], "default": { "id": "craftsmen", "name": "工匠镇" }, "fixed": { "capital": { "id": "capital", "name": "都城" }, "outpost": { "id": "outpost", "name": "野外营地" } } }` (keywords per spec section 6)
- Create: `packages/schema/src/themes.ts` (`pickTheme`, `ThemesConfig`), `packages/schema/src/towns.ts` (`buildTowns`, pure); add `guildSkillsOf(dir)` and `readOverrides(path)` to `packages/server/src/townsFs.ts`. The browser imports `config/themes.json` directly (Vite JSON import); the server reads it with `fs`.
- Modify: `packages/schema/src/payload.ts`
- Test: `tests/towns.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TownKind = "project" | "guild" | "capital" | "outpost";
  export interface TownRow { key: string; faction: Faction; projectId: string; name: string; kind: TownKind; guildOf: string[]; theme: string; counts: Record<RequestClass, number>; workCounts: Record<string, number>; lastEditTs: number | null; skillNote?: string }
  ```
  `key = faction + "|" + projectId` (the existing district key format).
- `pickTheme(text: string, cfg: ThemesConfig): string` — lower-case, split on non-alphanumerics (and keep CJK runs); first theme with a keyword equal to a token, or contained in a token of length ≥ 4 (so `slides_maker` → `slides` contains `slide`); else default id.
- `buildTowns(requests: RequestRow[], events: AgentTownEvent[], o: { themes: ThemesConfig; overrides: Record<string,string>; guildSkillsOf: (projectId: string) => string[]; describe: (skillKey: string) => string | undefined }): TownRow[]` — guild facts come from the injected `guildSkillsOf` (server: fs; demo: a fixed map).
  - kind: CAPITAL → capital; OUTPOST → outpost; guild if `guildSkillsOf(projectId)` is non-empty (server version: the dir is `<x>/skills/<name>`, or holds `skills/*/SKILL.md` or a root `SKILL.md`; names normalised); else project.
  - name: basename; collisions within a faction → `parent/basename`; capital/outpost → their fixed names; a guild whose dir is `skills/<name>` → `<name> 公会`.
  - theme: override by key if it names a known theme; capital/outpost fixed; else `pickTheme(name + " " + guildOf.join(" ") + " " + descriptions)`.
  - workCounts: tool_start count per `role`, plus `spawn` (agent_spawn) and `compaction`.
  - lastEditTs: latest ts of a tool_start with an `edit` file in that town's requests.
- `readOverrides(path): Record<string,string>` — missing/garbled file → `{}`.
- [ ] **Step 1: Failing tests**: `pickTheme("slides_maker")` → publishing; `"topic-to-video"` → film; `"music_suggester"` → music; `"lifeos"` + description `"daily fortune and destiny"` → stargazer; `"agent-town"` → toyworks; `"qzx"` → craftsmen; override wins; capital/outpost fixed; guild detection (dir `skills/alpha` → `alpha 公会`, guildOf `["alpha"]`; repo with `skills/beta/SKILL.md` → kind guild, name = repo basename, guildOf `["beta"]`); name collision `a/app` vs `b/app`; counts per class; workCounts; lastEditTs.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** run — PASS.
- [ ] **Step 5: Commit** `feat(server): towns with kind, guild skills, theme by keyword or local override`.

### Task 7: Payload and HTTP

**Files:**
- Modify: `packages/schema/src/payload.ts` (`WorldPayload.requests: RequestRow[]; towns: TownRow[]`)
- Modify: `packages/server/src/payload.ts`, `packages/server/src/http.ts`, `packages/server/src/load.ts` (expose `requestOf`)
- Modify: `packages/mock` demo payload builder so `?demo=1` also has `requests`/`towns` (built with the same functions, `describe` returning undefined)
- Test: `tests/payload.test.ts`, `tests/http.test.ts`

**Interfaces:**
- `compactPayload(full, mtimes, now, opts & { requestOf; config; themes; overrides; describe })` fills `requests`, `towns`.
- `GET /api/request/:id` → `{ requestId, events }` (all events of all its turns, sorted); 404 unknown; 400 bad id (same validation as `/api/task/`).
- `POST /api/theme` body `{ key, theme }` → 204; 400 unknown key/theme; 403 foreign Origin (existing check); writes `~/.agent-town/themes.json` (path injectable for tests), then rebuilds `towns` in the cached payload.
- [ ] **Step 1: Failing tests**: payload has one request per human turn of a synthetic two-session world; `towns` keys equal the distinct `faction|projectId` of requests; token sum over `requests` = sum over all model_call events; `/api/request/:id` returns both turns' events; `POST /api/theme` writes the file and the next `/api/world` shows the theme; foreign Origin → 403; unknown theme → 400.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** run, then `node --run test` and `node --run build` — Expected: green, build ok (web type-checks against the new payload type).
- [ ] **Step 5:** `node --run e2e` — Expected: the existing 20 browser tests pass (demo data now carries requests/towns).
- [ ] **Step 6: Commit** `feat(server): world payload carries requests and towns; request endpoint; local theme overrides`.

### Task 8: Real-data verification and record

**Files:**
- Modify: `docs/decisions.md` (D15)
- Create (scratchpad, not repo): an aggregates-only check script

- [ ] **Step 1:** restart `node --run start` on 5182; fetch `/api/world` and print aggregates only: number of requests by class, towns by kind, towns per theme, top-10 town request counts by kind (no names for project towns; theme ids allowed), sum of request tokens vs sum of turn tokens (must be equal), requests whose `productKind` is null while produced (must be 0), skills detected count (Claude Skill calls should no longer be "?").
- [ ] **Step 2:** look at the world page (still the v2 renderer): screenshot the world view to `~/Desktop/agent-town-v3/1-数据-新的镇.png`; confirm the town banners are now repo/guild names plus 都城 and 野外营地, and no `Downloads`/`Desktop`/`.cache` towns.
- [ ] **Step 3:** write D15 in `docs/decisions.md`: request = human turn + system continuations; four classes and thresholds; placement rules; guild definition; themes and overrides; what the existing renderer does with the new towns.
- [ ] **Step 4: Commit** `docs: D15 world v3 data`.
