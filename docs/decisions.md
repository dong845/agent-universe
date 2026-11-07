# Decisions — revisions to the plan after phase 0

The source plan is the PDF of 2026-10-25. Every change below rests on a measurement recorded in
[log-formats.md](log-formats.md). Anything the plan says that is not changed here still stands.

## D1 Hierarchy

```
faction (claude-code | codex)
└ project      normalised cwd
  └ session    one main transcript / one top-level Codex thread
    └ task     one human input → the agent stops
      └ agent  main | subagent (nests through parentAgentId) | workflow agent | guardian
        └ step one model call or one tool call
```

Changes from the plan:

- **Workflow agents.** The Claude `Workflow` tool starts a batch of agents. They live in
  `subagents/workflows/<runId>/`, and the tool result's `runId` names that directory (17 of 17 matched).
  Each one is an agent with `groupId = runId` and `spawnToolUseId` = the Workflow call. In the world,
  a group is **one scaffold block with its agents inside**, not N separate scaffolds.
- **Codex subagents are real.** `spawn_agent` writes a child rollout whose `session_meta.source.subagent.thread_spawn`
  carries `{parent_thread_id, depth, agent_nickname, agent_role, agent_path}`. The child is an agent
  inside the parent's session, never a session of its own.
- **Codex guardian agents** (`source.subagent.other = "guardian"`, 73 rollouts) are Codex's automatic
  approval reviewers. They are agents with `agentType: "guardian"`, attached to the task that was
  waiting for approval, so their tokens count against it.

## D2 Task boundaries

| Faction | A task starts at | It ends at |
|---|---|---|
| Claude Code | a `user` line with text and **`origin.kind == "human"`** (typed, queued or accepted suggestion), or a slash command (`<command-name>`) on older lines without `origin` | the next `system/turn_duration` record, which also gives `durationMs`; else the next task start |
| Codex | `event_msg/task_started` (`turn_id`) | `event_msg/task_complete`, or `turn_aborted` with `status: error` |

Claude messages with `origin.kind` of `task-notification`, `peer` or `auto-continuation`, and
`local-command-stdout`, belong to the **current** task. When no task is open they start one with
`trigger: "system"`. That case is drawn without the hall lighting up, because no human asked.

## D3 Tokens

`tokens = {input, output, cacheRead, cacheWrite, reasoning?}` — **all additive except `reasoning`,
which is a part of `output`** and is shown as the thinking bubble, never added to totals.

| Field | Claude (`message.usage`) | Codex (`last_token_usage`) |
|---|---|---|
| input | `input_tokens` | `input_tokens − cached_input_tokens` (cached is a subset; true in 15,199 of 15,199) |
| cacheRead | `cache_read_input_tokens` | `cached_input_tokens` |
| cacheWrite | `cache_creation_input_tokens` | 0 |
| output | `output_tokens` (max over the lines of one `message.id`) | `output_tokens` |
| reasoning | — (not reported) | `reasoning_output_tokens` (a subset of output) |

- **Don't trust Codex `total_tokens`**: 113 records disagree with input + output, so totals are
  always computed from the parts.
- **One model call is one event**, keyed by `message.id` (Claude) or by the position of a changed
  `total_token_usage` (Codex).
- **Upserting**: events are upserted by `id`. A later line for the same Claude message replaces the
  token values. While a newer line can still arrive, the event carries `provisional: true`, which the
  hover card shows as "generating…" next to output.

## D4 Context

- **Claude**:
  - `contextUsed` = the last call's `input + cacheRead + cacheWrite`.
  - `contextMax` comes from config, keyed by model, and is overridden to 1 M when the session has a
    `[1m]` model in `cost-state`.
  - `compactMetadata.preTokens` / `postTokens` drive the "pack the backpack" animation.
- **Codex**:
  - `contextUsed` = `last_token_usage.input_tokens`.
  - `contextMax` = `model_context_window`, which comes in the log itself.

## D5 Acceptance for token totals (replaces "< 1% vs official")

The transcript cannot match an official total: calls that never reach the transcript are missing,
and the gap measured 0.2–26% per model. There are two checks instead:

1. **Deterministic, gated.** The adapter's totals equal the independent probe's totals **exactly**,
   on every fixture and on the full local corpus. The probe is the Python one in `scripts/probe/`;
   it was written separately from the adapter on purpose.
2. **Reported, not gated.** Where a single-process `cost-state` exists, the UI shows
   `cost-state − transcript` per model as **"calls not in the transcript"**. The gap is never spread
   over steps.

## D6 Linking an agent to the step that spawned it

| Case | Link | Confidence |
|---|---|---|
| Claude subagent | `meta.json.toolUseId` = an `Agent` call (main or another subagent) | exact (484 of 484) |
| Claude workflow agent | directory `runId` = the `Workflow` result's `runId` | exact (17 of 17 runs) |
| Codex subagent → parent session | `parent_thread_id` | exact (85 of 85) |
| Codex subagent → spawn call | `spawn_agent` output `agent_id`, when present (2 of 13) | exact |
| Codex subagent → spawn call, otherwise | latest `spawn_agent` call before the child's first timestamp in the parent | **inferred**: marked in the UI |

## D7 Role rules (replaces the plan's table; lives in `config/roles.json`)

| Role | Claude | Codex |
|---|---|---|
| Commander | model text and thinking | model text and reasoning |
| Scout | `Read`, `Grep`, `Glob`, `LS`; agentType `Explore` | `exec_command` whose `cmd` starts with `cat` / `rg` / `grep` / `ls` / `find` / `sed -n` / `head` / `tail` / `wc` |
| Smith | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | `apply_patch` |
| Engineer | `Bash` (not a test, not a read) | `exec_command` / `exec` / `write_stdin` (not a test, not a read) |
| Inspector | `Bash` running a test (`pytest`, `npm test`, `vitest`, `jest`, `cargo test`, `go test`, …) | same patterns on `cmd` |
| Messenger | `WebSearch`, `WebFetch` | `web_search_call` |
| Diplomat | `mcp__*` | MCP tool calls (`mcp_tool_call_end`) |
| Scribe | `TodoWrite`, `Task*` todo tools; agentType `Plan` | `update_plan` |
| **Painter** (new) | — | `imagegen`, `view_image` |
| **Operator** (new) | computer-use / browser tools | `click`, `type_text`, `get_app_state`, `set_value` |
| **Sentry** (new) | — | guardian agents (approval review) |

- **Spawn and wait calls** are not roles. `Agent`, `Workflow`, `spawn_agent`, `wait_agent` and
  `list_agents` are dispatch actions by the commander.
- **The two new roles and the new building**: Painter and Operator are new because these tools
  appear in about 1,200 Codex calls here. Sentry needs a new building, or a post at the Task Hall,
  where approvals already happen. **This is open for the owner to decide.**

## D8 History retention

Claude Code deletes old transcripts (only ~18 days survive here). Agent Town therefore:

- keeps every derived event in its own SQLite, so the town outlives the transcripts;
- shows the earliest available date;
- offers, at `install-hooks`, to raise `cleanupPeriodDays`. It writes the setting only after the user agrees.

## D9 Record identity and copies

- **Ids are global.** An event id is a hash of the API message id, the tool id or the record uuid.
  It never comes from the file, so a copy carries the same id as its original.
- **Inside one session.** The first agent file that holds a record owns it. For model calls, the
  largest `output_tokens` seen for the message id wins.
- **Across sessions.** The session whose first event is earliest owns a record; later copies are
  dropped. This is the SQLite unique key in phase 1, and `scripts/parse.ts` does the same today.
  The adapter's per-session totals still include copies, which keeps the D5 probe comparison exact.

## D10 Phase-0 parser status (2026-10-26)

`node scripts/parse.ts` reads both tools' local logs with no dependencies (Node 22 runs the
TypeScript directly).

**Measured on this Mac**: 10 Claude sessions and 476 Codex rollouts in ~40 s, giving ~293 k events.

| Check | Result |
|---|---|
| Token totals vs the probes (D5) | identical for **9 of 9** finished Claude sessions and **476 of 476** Codex rollouts. The live session is reported, not compared. |
| Spawn links | Claude 630 of 630 exact. Codex: 2 exact, 10 inferred, 73 guardians (no spawn call, by design). |
| Unrecognised record kinds | 0 |
| Bad lines | 0 |
| Fixtures | identical to the probes; no leak hits |
| Damaged input (garbage line, cut-off last line, unknown kind, empty file) | counted, no crash |

**Not covered yet**:
- hook events (needs `install-hooks`);
- workflow and nested agents in the fixtures;
- unit tests (phase 1, Vitest).

## D11 Owner decisions (2026-10-26)

1. **Sentry**: a guard post at the Task Hall, where approvals already happen. No new building.
2. **Painter and Operator**: one building each, the **Studio** (image tools) and the **Control Room**
   (screen and browser operation). With them, the work site has 9 tool buildings around it (the plan's 7 plus these 2).
3. **"Calls not in the transcript"** (D5): shown on the 2D dashboard only. They have no task or step,
   so placing them in the world would break "every element maps to real data".

## D12 3D prototype rules (2026-10-27)

**Rework.** The rule is implemented in `packages/schema/src/insights.ts`:
- A failing test opens a "failing stretch", during which the site smokes. The next passing test or
  the task end closes it.
- Inside the stretch, each successful edit counts against its file. When one file reaches **3**
  edits, the rework cloud appears.
- These do not count: edits made before any failure, failed or denied edits, and denied tests.

**Lag.** Every animation action carries a `due` time: when the thing it shows actually happened.
- No action starts more than 3 s after its `due` time. A figure that would start later has its
  current action cut short (fast-forward).
- A walk never takes more than 1.5 s.
- A figure that is behind runs at double speed.
- Checked on all 3,114 real tasks here (382 k actions): 0 violations.

**Positions.**
- The commander stands beside the site, on the camera side, not inside the floors it builds.
- Figures working at one building at the same time get separate lanes beside its door.
- Scaffold slots run in two rows that read horizontally from the default camera.

**Changes from the plan.**
- **Subagent task labels sit under the scaffold, not over the figure's head.** Measured: two
  subagents at one building made the head labels overlap, and one covered a building name.
- **Labels are one DOM overlay placed by a projector inside the canvas, not drei `<Html>`.** Under
  React 19, `<Html>` remounted each label at startup, and the Library's label was lost.
- **React 19 instead of React 18.** React Three Fiber 9 requires React 19.
- **No prices in the prototype.** Cost shows as "未配置价格" (no prices configured): no price table is
  shipped, and no price is guessed.

## D13 The world (2026-10-27)

**Art direction.** The owner picked the warm clay toy town (Townscaper style). Codex uses the same
direction in cool colours and square-edged shapes, which is the plan's warm/rounded versus
cool/square rule.

**Layout.** `buildWorld()` in `packages/web/src/orchestrator/worldgen.ts` is a pure function.
- **Territories.** A continent split by a river: Claude to the west, Codex to the east.
- **One district per faction and project.** A path that both factions use becomes two districts,
  placed on the same row across the river.
- **Placement.** Each district sits on a staggered grid slot, chosen by FNV hash of the project path
  with open addressing. A district keeps its place when another project appears, unless the
  newcomer takes its preferred slot first.
- **Tiers.** Five tiers by cumulative tokens: < 3 M, 3 M, 10 M, 30 M, 100 M (村落 village, 小镇 small
  town, 镇 town, 大镇 large town, 城区 city). A low wall appears from tier 3, towers at tier 5.
- **Houses.** Every finished task is a house in rings over the back 210° of its district. Height
  encodes size (log2 of tokens / 60 k, 1–6 floors); the roof is grey when the task failed, and a
  green flag marks success. At most 14 houses per tier are drawn; older tasks are counted, not drawn.
  A live task (one with tool calls) is drawn as its site, never also as a house.
- **Bridges.** One per pair of districts, standing from the first crossing. A crossing is the other
  faction starting on the same path ≤ 30 min after a task ended. Every crossing is recorded and the
  bridge is labelled "推断" (inferred).
- **Capitals.** Each faction has a capital (its Task Hall, "你") on the south coast, with roads to
  every district.

**Ledger keys.** Building statistics are keyed by district (faction + project), not by project:
`/demo/web-shop` exists in both factions and would otherwise have merged.

**Level of detail.**
- **Full detail** (buildings, figures, effects, labels): towns with a live task, the focused town,
  and up to 4 towns near the view centre once the camera is zoomed in (zoom ≥ 11).
- **Every other town:** simple instanced massing (buildings, plaza, clock tower).
- **Scenery and houses:** mountains, forest, roads and houses are instanced. Houses change only their
  drawn count during playback.

**Camera.** The view opens on the whole world. Double-clicking a town, or pressing 当前活跃工地 (active
site), flies there; 全景 (overview) returns.

**Frame rate.** Measured on an Apple M4, production build, 1440×900, all effects on: **60 fps, p95
17 ms**, in both the world view and the town view.
- The dev server shows 40–50 fps while playing. That is dev-mode React overhead on the
  4-times-a-second UI refresh; paused, the dev server holds 60.
- **Not measured: the plan's M1 MacBook Air.** The hidden switches `?dpr=` `?post=0` `?shadow=0`
  `?fx=ao,bloom,tilt` are the levers for the plan's quality setting.

## D14 World v2, step 1: real data, click to zoom, task diary (2026-10-28)

Spec: `docs/superpowers/specs/2026-10-28-world-v2-design.md`. Plan: `docs/superpowers/plans/2026-10-28-world-v2-step1-real-data-diary.md`.

**Running it.** `node --run start` builds the page and serves it with the real logs on `127.0.0.1:5182`; `?demo=1` is the simulated world. The root scripts do not call `pnpm` (not on PATH on this Mac).

**Loading.** `packages/server/src/load.ts` caches parsed sessions in `~/.agent-town/cache/` (keyed by file mtime + size, `CACHE_VERSION` 3). Measured here: cold 34 s, cached 2.3–3.3 s, 293 k events. D5 after the refactor: Claude 10/10, Codex 476/476 identical.

**Which town a task belongs to** (owner decision): the repository or folder holding most of the files it touched.
- Exact paths (file tools, patch headers) outvote inferred ones (paths in shell commands that exist and lie inside home); home never votes.
- Temp directories are by-products: they decide only when nothing else does; all temp work is one 临时工地 per faction.
- A task that touched nothing falls back to its working directory's git root. The rule is recorded per task (`projectBy`) and shown in the diary.
- Why: every Claude session here runs from `~`; by working directory all 1,991 Claude tasks were one town. Now 42 Claude and 48 Codex towns (plus temp).

**Payload.** Finished tasks travel as start / one summed call per agent / end; live tasks (no end, file written ≤ 10 min ago, at most 6) in full; building statistics as pre-summed rows. Every token total equals the full events' (tests/payload.test.ts). Real: 293 k events → 10 k + 5.9 k rows, 5.7 MB.

**World size.** The grid grows with the town count; spacing = max(44, 2 × largest radius + 4); coast, capitals, river, mountains and forest follow it. Real: 104 towns, ±354 × ±238.

**Readability on real data.**
- Town banners in the overview give way to a bigger (or live) town they would cover.
- Same-named folders show `parent/name`; home is 主目录.
- The clock shows local date and time; during a replay, the replayed task's own time.

**Tasks with no recorded end.** If not live, they are houses with no flag and a normal roof, "未见结束".

**Turns not opened by a prompt.** Subagent hand-backs, compaction summaries and meta lines continue the last human request: `continues` + `triggerBy`, shown as "接续：…". 1,232 of 1,255 now named.

**Selection.** Click (not drag, > 5 px) a house, site or figure. The camera pushes in (zoom 40 / 34) or follows the agent until you drag. Esc goes up a level; the URL hash keeps the selection.

**Diary.**
- Steps per agent, with the tokens of the call that read each result. Parallel calls credit that call once; the others show "—".
- Rework files and replay. Replay rebuilds the task on its town's central site, not at the house; that moves to the house once streets exist (step 2).

**Frame rate** (M4, production build, Metal, 1440×900, all effects): 60 fps, p95 17 ms in the real overview, the live town, the largest real town, and both demo views.

**Known, for step 2:**
- Small towns from incidental shell paths (`.cache`, `hi`, `data`).
- 886 Claude tasks still fall back to `~`: relative paths after `cd`, and notification turns.
- UI chrome can cover a banner at the top edge.

## D15 World v3, step 1: requests, skills, towns, themes (2026-10-29)

Spec: `docs/superpowers/specs/2026-10-29-world-v3-design.md`. Owner picked: 2.5D Codex-drawn buildings per town theme, only useful work shown, plain names, skills as guilds, KayKit figures.

**Request = a human turn + the system turns that continue it** (subagent hand-backs, compaction summaries, meta lines; same faction and session). All turns of a request share one town. Real data: 3,129 turns → 1,901 requests.

**Classes.** produced = any exact edit or image generation; investigation = otherwise ≥ 20 tool calls; chat = ≥ 1 call; empty = none. Real: 851 / 164 / 573 / 313. Product kind by edited file extensions (one vote per edit; image tools vote image; `…/remotion/…` → video; html/pdf under slides|deck → slides; tie order code, docs, slides, image, video, data). `config/world.json` holds the numbers.

**Adapters.** tool_start carries untruncated `files` (Claude file tools; every Codex patch header, including patches whose line breaks are written out as `\n`). Claude's Skill tool target is the skill name. D5 after the change: Claude 10/10, Codex 480/480 identical.

**Placement**, first match: temp folder → 野外营地 (outpost); `…/skills/<name>/` → that skill's guild (the repository when the folder is inside one); git repository (worktrees → main repo); the tools' own folders (`~/.claude`, `~/.codex`, `~/.agents`) → 都城 (capital); nearest folder below home with a project marker; the folder the session started in, if the file lies under it and it is not home, a standard home folder or a dated folder; else the outpost. Capital and outpost votes are weak (any real town outvotes them). Copies of one skill (installed copy, build output) join the repository holding `skills/<name>/`, else the most-used copy. Real: 104 towns → 43 (22 projects, 17 guilds, 2 capitals, 2 outposts); none malformed.

**Themes.** Keyword rules in `config/themes.json`; the name decides first (its last matching word: `slides-to-video` → film), then guild skill names, then their local SKILL.md descriptions; else 工匠镇. The owner's choices go to `~/.agent-town/themes.json` via `POST /api/theme` (loopback, Host/Origin checked), never into git.

**API.** `/api/world` adds `requests` and `towns`; `GET /api/request/:id` returns every turn's events. Request tokens equal the per-turn model calls exactly (30.15 B on real data).

**The v2 renderer** still draws per turn from events; it simply sees fewer, better-named towns until step 3 replaces it.

## D16 World v3, step 2: art pipeline (2026-10-31)

Plan: `docs/superpowers/plans/2026-10-29-world-v3-step2-art.md`. Python under `scripts/art/` (numpy/scipy/Pillow), tests `node --run test:art` (synthetic images only).

**Flow.** `art/catalog.json` (generic: style, view, background, 3 themes × 6 landmark ideas × 3 tiers + 6 house kinds × 2 variants, 12 public buildings × 2 faction colours, misc, props) → `prompts.py` (refuses any prompt carrying a local town name; only short plain catalogue words like "music" are exempt) → `generate.py` (`codex exec` on the subscription, each run in its own folder; falls back to the image in that run's own rollout) → `cutout.py` → `qa.py` → `pack.py` (512 px and 128 px WebP, manifest with the footprint anchor) → contact sheet. `node --run art -- --themes … --shared [--only|--redo GLOB]`; refuses to start without the local server (no town names to check against).

**Cut-out.** Magenta connected to the border is background; so is any enclosed patch whose median pixel is pure #FF00FF (background seen through a gap — tent openings, under benches; found by looking at the sheet after every check had passed). Purple and pink details stay. Spill is removed on the 3-px rim only.

**Checks.** Clear border; kept share 15–95 %; no pink on the rim; no pure magenta inside; aspect 0.45–2.2; buildings only: the footprint's half-width grows 1.5–3.0 px per px of height (calibrated on 18 real Codex buildings at the right angle: 1.67–2.63; front-on ≈ 0, top-down ≈ 1). Up to 2 rerolls; failures go to the sheet's 待你看 row, never into the manifest.

**First batch: blocked.** Codex answered "You've hit your usage limit … try again at Nov 28th, 2026" (plan go). The driver now reports Codex's own error. Owner chose: no paid API; go on with the 20 images already drawn for the demo, imported through the same cut-out and checks as **interim** (`art/interim-map.json`, `scripts/art/import_raw.py`; promptHash "interim", so the next real batch redraws them). In the repo: 40 WebP, 1.3 MB. Known: the forge's smoke is faintly pink (the catalogue now asks for no smoke).

## D17 World v3, step 3: the 2.5D world (2026-10-31)

Plan: `docs/superpowers/plans/2026-10-31-world-v3-step3-world.md`. The v1/v2 3D world (buildings, figures, sites, looks, post-processing) is deleted; `orchestrator/timeline.ts` stays for step 4.

**Town layout** (`v3/townLayout.ts`, from the demo the owner approved): landmark at the centre (growth stage by finished work 1 / 10 / 40, each stage shown from when it was reached); task hall, notice board (Q&A count) on ring 1; paving on ring 2; one public building per kind of work done ≥ 5 times on ring 3; from ring 4 one wedge per top folder (≤ 6, the rest "其他"); houses = the larger half of finished requests by tokens, at most 20 (the rest counted on the street sign); tents = the 6 investigations with the most calls on the edge; trees towards the coast. A request in progress always stands as a house from its start, faded with a pulsing ring (scaffold art not drawn yet).

**Archipelago** (`v3/archipelago.ts`): Claude west, Codex east, 24-unit strait; each side capital first at the strait, then guilds, projects by finished work, outpost farthest out; spiral placement, 6 units of sea between islands.

**Art** (`v3/art.ts`): stated fallbacks — theme → 工匠镇 → 出版镇; variant b → a → any house of the theme; landmark nearest tier → any idea; public building other faction → the hall; capital → hall; outpost → tent. A stand-in says 示意图 in the hover card. Landmark ideas 1–6 per theme by stable key order.

**Rendering**: fixed camera (azimuth 45°, elevation 30°), pan and zoom only; zoom = px per world unit (0.5–160; a town ≈ 16, a request 80). One instanced mesh per picture, one shared facing; quads raised toward the camera so the ground never cuts them; MSAA + alpha-to-coverage. Banners always (bigger towns win overlaps; the HUD and time bar are kept clear); building names and street signs once their island is ≥ 300 px across. Picking reads the picture's alpha, so a transparent corner never steals a click.

**Interaction**: hover card per request (title, the user's own words for a bare 可以/继续, product, outcome, time, 4 token parts, calls/failures/subagents/turns, skills); click flies to the house and opens the request's diary (one section per turn); a public building, landmark, hall or notice board opens the town's summary. `#req=<town>~<id>`, `#town=<key>`; old `#task=` links open the request holding that turn.

**Real data found**: Codex runs started by image tools inside output folders (`assets/generated`, `.assets`, `video`…) became towns; output folders are now lifted to the folder holding them (45 towns, all named after real projects or decks).

**Measured** (M4, production build, real data, 1440×900): world view 60 fps p95 17 ms; largest town 60 fps p95 17 ms. Browser tests: 6, on demo data (the demo's history now has real shapes; only its live window is live). Not tested in the browser: houses appearing while scrubbing (no demo request ends inside the timeline) — unit-tested on the time filter.

## D18 The star-system world and its cities (2026-11-01)

Owner, after the 2.5D town (D17): "think of a style like Dyson Sphere"; picked **A 星系工厂** over orbital stations, a sci-fi reskin of the 2.5D town, and a blueprint look; saw a demo on real data, then chose it as **the** view ("用星系"; the 2.5D renderer is deleted — `v3/World25.tsx`, `Labels25.tsx`, `pick.ts`). Everything is drawn from geometry and shaders (three.js / R3F, bloom), so it needs no generated art; the art pipeline (D16) is unused by the page for now.

**Space** (`galaxy/`): each faction is a star (Claude Code west, Codex east); each shown town is a planet on its own orbit (capital nearest, then guilds, then projects by finished products, outpost farthest; Kepler-like periods; the orbits run whatever the time bar does — it stops by itself at its end — and only a `?paused=1` link holds them, for screenshots and tests). A **Dyson shell** of 1 280 panels per star lights one panel per finished product (equatorial band first), as of the playback time. Planet size grows with finished products; a ring = 40 or more. Each theme is its own kind of world (ice, lava, gas, ocean, rock, moon). The town layout (D17) stands on the planet's top as a city: products as towers with light bands (colour = kind), kinds of work as round towers, investigations as domes, landmark spire, hexagonal task hall; conveyor belts from every building to the hall carry light dots (denser = more tool calls); trade ships fly between two towns when one session moved between them (the 40 busiest routes per side). Faction emblems are our own shapes in the spirit of each mark (Claude: a sunburst; Codex: three interlocked rings), never the logos: around each star (fading as the camera comes close), over each hall, before every name.

**Hidden towns** (owner): a town with fewer than 2 finished products is not drawn unless work is going on there; it still counts towards its star's shell, and the corner says how many are hidden (`MIN_PRODUCED`).

**Camera**: overview of both systems; the wheel zooms toward the cursor; zooming in on a planet locks onto it and follows its orbit, zooming far out lets go where you are; "回到全景" flies back.

**Cities** (`city/`, owner: clicking a planet should enter a city with agents at work and buildings for each function): a click flies to the planet, fades, and opens its city — the same layout on flat ground (hex cells for lots, plaza and streets with runway lights, the planet's own terrain beyond), the same buildings, belts to the hall, the star low in the sky with its emblem. Labels: work buildings' plain names and counts, hall, Q&A board, street signs. "← 返回太空" / Escape goes back.

**Agents** are small hover robots (owner's pick): visor and antenna in the faction colour; the main agent wears the faction emblem; subagents are smaller with a chest light in their role's colour. They run on the existing timeline (`orchestrator/timeline.ts`), which now takes a town's **places** (`buildTimeline(events, places)`; the default keeps the old district): a tool call sends the agent to that kind of work's building (or to the hall when the town has none), waiting for the user raises a hand, an error knocks it over, a denial shakes it, compaction shows the thinking ring, the end of the request is a cheer. A bubble says what each robot is doing ("主代理 · 跑命令", "等你回复", "思考" between events, "完成").
- **Live**: requests in progress walk on the world clock.
- **Replay** (owner: "实时 + 点房子重放"): a house → its diary → "进城重放这次请求". The replay has its own clock (1/2/4/16×), quiet gaps longer than 5 s are shortened to 5 s (the bar says so), and the camera follows the main agent from above (can be switched off).

**Measured** (M4, Chrome, 1440×900, DPR 1, real data): space overview 60 fps p95 17.7 ms (after moving the nebula to the vertex shader; it was 51 fps p95 33 ms), a planet close-up 60 fps. Retina (DPR 2) not measured.

**Bug found by looking**: the conveyor belts were built but invisible — their triangles faced into the planet and were back-face culled (a plain red material showed nothing either). Belts are double-sided now.

## D19 The city in Blender (2026-11-01)

Owner: "需不需要使用 blender" → picked Blender for the robots and the buildings; then "城市的设计也可以交给 blender，做一些精美的设计". Blender 5.2 (already in /Applications) runs headless on scripts; the models are generated, never hand-edited, so a change is a script change:

- `scripts/models/robot.py` → `public/models/robot.glb` (0.3 MB): a hover robot about one unit tall — rounded torso with a chest light, backpack, thruster skirt with a glowing ring, a wide head with a dark glass visor and two glowing eyes, ear discs, antenna, two-finger claws. Moving parts are named nodes (`Body`, `Head`, `ArmL`, `ArmR`); the browser animates them by the timeline's pose (walk lean, working arms, a raised hand, falling over, shaking, a cheer) — no baked animation clips, so the motion keeps following the data. Glowing materials (`Visor`, `Chest`, `Accent`, `Thrust`) are recoloured per robot: faction for eyes and antenna, role for a subagent's chest.
- `scripts/models/city.py` → `public/models/city.glb` (1.5 MB, 27 pieces): houses in three heights (by the request's size tier) with window bands, glass fronts and roof clutter; the investigation dome; **a different top for each kind of work** — 读代码 scanner telescope, 改代码 crane arm, 跑命令 reactor with stacks, 测试 ring gates, 联网 antenna mast with dishes, 外部工具 docking pad with a shuttle, 计划 holo-table, 看图/生图 crystal prism, 操作屏幕 big screen, 派子代理 hangar, 压缩记忆 compressor silo; the task hall; the landmark in three tiers; the Q&A board; hex ground tiles (lot, plaza, street with a runway light, wild ground); lamps, crates, crystals.

Pieces stand on their own origin, front towards the city's square; within a piece the meshes are joined per material, so a city draws one InstancedMesh per piece part. `Accent` and `Ground` take a per-instance colour (product kind, kind of work, faction, the planet's ground). A studio reflection made locally (three's RoomEnvironment) lights metal and glass — no downloaded HDR. While the kit loads, the plain shapes of D18 stand in. Space (the planets' tiny cities) keeps the plain shapes.

Browser test note: entering a city under the tests' software renderer (SwiftShader) keeps the page busy long enough that Playwright's wait-after-click times out; the replay test clicks from inside the page.

## D20 Prettier cities, planets in the kit, retina speed (2026-11-01)

Owner: smaller robots, a prettier city, and the open items done.

- **Robots** 1.9 → 1.15 (subagents 0.85) of the model's size.
- **City**: each house tier has a second design picked per request (a pod house under an arched roof; twin towers with a sky bridge; a round tower with balcony rings); two holo fountains on the square, benches, glowing bio-trees and crates; raised rocks, trees and crystals on the wild ground; low-poly snow-capped mountains in two broken rings on the horizon; hover cars gliding out and back along each street; a haze in the planet's colour; the faction's star with its Dyson shell (as built by now) hanging in the sky. 36 kit pieces, 1.9 MB.
- **Planets in space**: the planet the camera is on wears the kit, its pieces placed on the sphere and merged into one mesh per material (a hit finds its block from the vertex index); the other planets keep the plain shapes. A faint studio reflection keeps the kit's night side readable.
- **Replay**: "⏭ 下一步" jumps to the next thing any agent starts doing.
- **Frame rate** (`?fps=1` shows it), headless Chrome on the M4, 1440×900, production build — headless matched a real window at DPR 1 (60 fps in space before):
  - DPR 1: space 60 fps, the biggest city 60, the live city 60 (p95 16.8 ms).
  - DPR 2, before: space 34, cities 29. Two causes found by measuring: 4× multisampling under the post effects (space 34 → 60 without it), and the ground beyond the city computing its noise per pixel over most of the screen (cities 37 → 54 when moved to the vertex shader of a dense disc). Shadows from tiles and props were not the cost (tried; kept off anyway, map 1024).
  - DPR 2, after: space 60, cities 53–55 (p95 33 ms). Multisampling is now off at DPR ≥ 1.5 (`?msaa=N` overrides).

## D21 The faction marks (2026-11-01)

Owner: the home-made Claude and Codex emblems (D18: a sunburst, three rings) "didn't feel right"; chose solid versions of the official marks, made in Blender. Sources in `art/logos/`, from Wikimedia Commons: `claude.svg` (File:Claude_AI_symbol.svg, Claude's spark) and `openai.svg` (File:OpenAI_logo_2025_(symbol).svg, OpenAI's blossom — Codex is OpenAI's). `scripts/models/emblems.py` imports each SVG as curves, extrudes and bevels it, centres it, scales its larger side to 1 and stands it facing the camera side → `public/models/emblems.glb` (0.4 MB; nodes `E_claude-code`, `E_codex`). The labels draw the same SVG paths. The marks belong to Anthropic and OpenAI and only label each side in this local tool; nothing here is published (the repository has no remote).

Where they show: before every planet and star name; around each star (a faint hologram that fades as the camera comes close); above every task hall, in space and in the city; on the main robot's head.

## D22 Needs-you alerts and sharing (2026-11-01)

Owner asked what would make Agent Town attractive as a product. A market look found the "agents as characters in an office or town" idea crowded (Pixel Agents, claude-office, and two other GitHub repos also called agent town), mostly live status screens; the owner picked two directions to add first: **"需要你" alerts + resume** and **sharing (replay video, share page)**. Spec `docs/superpowers/specs/2026-11-01-attention-and-sharing-design.md`, plan `docs/superpowers/plans/2026-11-01-attention-and-sharing.md`.

**Alerts.**
- The server now watches both log roots (`fs.watch`, recursive) and pushes over `GET /api/stream` (server-sent events): `world` (re-fetch `/api/world`) and `attention`. The page applies a new world with `store.reload`, keeping focus, city, selection and a scrubbed clock.
- A reload must be cheap: a cached reload of the real record took ~6 s (18 s right after a full parse; machine load 12–21). Parsed units now stay in memory between reloads (`LoadOptions.memo`; events are shallow-copied before town assignment rewrites them) → ~2 s + 1.5 s payload. One live session can still be huge (this session's log was 202 MB, ~9 s to re-parse), so watched reloads wait max(3 s, 2× the last reload).
- States (`schema/src/attention.ts`): **可能在等你授权** — a call that can need approval, open ≥ 20 s (never subagent spawns, read-only tools, `bypassPermissions`/`auto` sessions, edit tools under `acceptEdits`, Codex `approval_policy: never`); **在等你授权** — from a hook; **本轮完成，等你回复** — the session's last task ended (Claude `turn_duration`); **出错停止** — an API error with nothing after it for 10 s. A Codex `turn_aborted` is a finished turn, not an error (it is usually Esc). The logs cannot say "waiting for approval" while it happens — Claude writes the decision after it was made — so the log guess is labelled 可能.
- The adapters now put `cwd` and `permissionMode` on every `task_start` (Claude `permission-mode` records; Codex `turn_context.approval_policy`); request rows carry `cwd` for the resume command (local only, never exported).
- **Optional precise hooks** (settings panel): Claude `Notification` (matcher `permission_prompt`, fires ~6 s into a prompt) + `Stop` in `~/.claude/settings.json`; Codex `PermissionRequest` + `Stop` in `~/.codex/hooks.json` (both checked against the official docs, see log-formats.md). Merged, never replacing; byte-for-byte backup first (an earlier backup is never overwritten); marked `# agent-town-hook`; off removes only ours. The command posts stdin to `/api/hook` with `curl -m 1 … >/dev/null 2>&1 || true`, port read from `~/.agent-town/port`.
- **macOS notifications** via `osascript`, once per (session, state); turn-done notifies only if switched on. Clicking one opens nothing (no helper installed).
- **Page**: the 需要你 list (click flies to the town and opens the request; 复制恢复命令 copies `cd '<folder>' && claude --resume <id>` / `codex resume <id>`), a pulsing ring on the planet, the settings panel, the diary's resume button.

**Sharing.**
- **Mask by allowlist** (`schema/src/share.ts`): the shared world is rebuilt field by field; a field not listed never leaves. Town keys and ids become HMAC ids; towns get code names (`Kepler-07c`) from a per-install secret in `~/.agent-town/share-secret`, so a town keeps its code name across exports and a guessed project name cannot be tested. Titles become their kind and size ("完成作品 · 12 次调用"); folders, paths, session ids, skills, prompts, tool targets, files, model names and the owner's agent-type names are dropped. "显示真实名称" keeps town names and titles, still no paths.
- **Share mode in the page**: the drawn world is swapped for a masked copy (same keys and layouts, so nothing moves; street names become 第 N), emblems become our own neutral sunburst / three rings (restored from D18 — the official marks of D21 never leave this machine, even with real names on), the diary cannot open.
- **Replay video**: "● 录制" on the replay bar; the page switches into share mode (what is on screen is what is recorded), the replay restarts, and each frame the WebGL picture plus the visible HTML labels are painted into a 2D canvas (a `useFrame` at priority 2, after the effect composer) → `MediaRecorder` MP4 (H.264) or WebM; GIF via gifenc (10 fps, half size). Ends with the replay, on 停止, or at 60 s. Measured on demo data: MP4 1440×900 ~30 fps, 29 s = 28.5 MB; GIF 26 s = 34 MB.
- **Share page**: "⇪ 导出分享页" → `POST /api/export/share` → one HTML file: the single-chunk production build inlined, city and robot models embedded (never `emblems.glb`), the masked world and up to 5 masked replays. Opens from `file://` with no network; a shared world's clock spans its requests and opens finished; replays are reached from a "可以重放的请求" panel. Real record with one replay: 6.6 MB; 15 MB target, 40 MB hard limit (413 names the largest part). The arrangement of planets differs from the owner's own view, because layouts hash the (now opaque) town keys.

Lessons: the real server runs its TypeScript through node's type stripping, which rejects syntax vitest accepts (a parameter property would have killed the server at start while every test passed) — `tests/node-strip.test.ts` loads every server module under plain node. `String.replace` with a minified bundle as the replacement string reads `$&`/`$'` as patterns; use a function. And a `.diary button` rule had hidden the diary's replay button since D18 (light text on light) — found only by looking at a screenshot.

Frame rate with the watcher running (headless Metal, production build, 1440×900, real record, machine load 12–40): DPR 1 59.6 fps, DPR 2 57.2 fps, p95 16.8 ms. Applying a newer world rebuilds the page's world from ~1,900 requests: one ~200 ms frame. Worlds are therefore applied at most once per 30 s and never during a recording (the 需要你 list is not throttled). Making that rebuild incremental is open.

## D23 History steps; project names in exports (2026-11-01)

Owner: planets should keep their project names (exports included), and towns not in progress need a panel to choose a step of their history — not a video — with an explanation.

- **Exports**: two switches replace "显示真实名称": 显示项目名称 (on by default) and 显示请求标题 (off by default — titles are the owner's own words). With project names on, skill names and street folders stay too; code names remain for when project names are switched off. Paths, the folders sessions ran in, session ids and log content never leave, as before.
- **History panel** (city): every non-empty request of the town is a step, oldest first by end time. Choosing one pins the world to the moment that request finished (`store.historyAt`, read by `absTime`) — only the buildings standing then, the shell in the sky and the top bar's totals as of then; nothing plays. The step's building gets a ring and the camera turns to it; ◀/▶ and ←/→ walk the steps; a house clicked while the panel is open jumps to its step; 回到现在 releases the pin. A city with nothing in progress opens on its history at the latest step; the others have a ⟲ 历史 button.
- **The explanation is assembled from the record only**: time and duration, result (kind and product), turns, agents (distinct agents in its events), subagents sent, tool calls and failures, tokens, skills, the folder changed most, tool calls by kind of work, and the files it edited (relative to the project, most edited first). Nothing is summarised by a model.
- Limits, stated in the panel: a city draws at most 20 houses and 6 tents (the biggest), so a step may have no building of its own; Q&A builds nothing. The counts on public buildings, the Q&A board and the streets are kept only as totals, so they are hidden at a history step rather than shown wrong; the time bar is hidden too.

Follow-ups (2026-11-03, owner: jitter in history, agents teleporting, no subagents seen):
- **Jitter**: each step re-rendered every row of the list and built a new `Intl` date formatter per row — a 263-step town stalled ~550 ms per step. One shared formatter and memoised rows: max frame 17 ms over 12 steps on the real record.
- **Teleporting**: on real data the clock stands at the newest record (no live mode), so live agents stood still and jumped whenever a newer world was applied. Now a newer world arriving while the clock is at the end plays the missed stretch at a speed that covers it in ~6 s, then stops at the new end and restores the owner's speed. Measured: no single-frame move over 40 px across an update.
- **Subagents** were drawn in replays all along (249 of 2,074 real requests spawned some) but rarely seen: history steps showed no agents, and in replays they often appear minutes in. A history step now stands its agents by the task hall — the main agent in front, up to 12 subagents on an arc — each labelled with who it was and its call count, and the facts list each subagent's type, task and kinds of work (from the logs). Live agents are hidden while a history step is shown.

## D24 Live, truer history, ready for others (2026-11-03/04)

Spec `docs/superpowers/specs/2026-11-03-live-history-release-design.md`. Owner picked: only update what changed (then live), a truer history, ready for others; name **Agent Universe · 智能体宇宙**; official marks out of the repo with an opt-in local download; clone + one command; a sentence from the logs for untitled requests.

- **Tail parsing.** Both adapters became line-fed parsers (`ClaudeSessionParser`, `CodexThreadParser`) whose `finish()` builds the result without changing the state; `ClaudeLive`/`CodexLive` feed only the complete lines appended since the last read (`readJsonlFrom`), and parse again from the start when a file shrank, its first bytes changed, a subagent's meta changed, or a subagent was fed before its spawn could be resolved. Events now sort by one total order (time, file, line, place in line) so the result does not depend on how lines were interleaved. Proof: a synthetic Claude session (with a subagent, token growth, a blank line, an open task) and a Codex thread (a child appearing midway) give exactly a full parse's events after every appended line. Measured on the real record: a reload 14–33 s → 1.4–1.9 s. A tail read does not rewrite the disk cache (the next full parse does).
- **Incremental page.** Unchanged towns keep their layout and planet objects (`layoutCache`, `planetCache`, `systemCache` keyed by what they are built from); the unused archipelago placement is cached; a newer world is downloaded, parsed, prepared (three steps) and applied in separate frames. Measured: the longest frame of an update ~200 ms → 33–50 ms. Worlds now apply every 5 s.
- **Live (实时).** Real data follows the newest record: real speed while within 15 s of it (records arrive in batches), hurrying back when further behind, waiting at the newest. Scrubbing or pausing leaves live; 实时 returns (straight to now when more than a minute back). Replaces the catch-up.
- **History.** Request rows carry calls per kind of work (`work`); at a step, public buildings show the counts as of then and those not yet built (< 5) are not drawn, the Q&A board counts Q&A ended by then; a produced step the city does not draw gets a house by its street for that step; untitled requests get `gist`, one sentence from their own events (files edited, else first command, else web, else reads, else calls) — 894 of 1,178 untitled real requests. `gist` never leaves the machine (allowlist; share mode drops it unless titles are shown).
- **Name.** Everything a person sees says Agent Universe; `~/.agent-town/`, the hook marker and the cache keep their names.
- **Marks.** `art/logos/*.svg`, `emblems.glb` and `scripts/models/emblems.py` left the repository. `/api/logos` downloads both SVGs from Wikimedia Commons (`Special:FilePath`) into `~/.agent-town/logos/` (checked: small SVG with a path, no script); the page extrudes the solid marks in the browser (three's SVGLoader + ExtrudeGeometry, the Blender script's proportions). The owner's download was byte-identical to the former repo copies. The marks remain in the git history already pushed to the private repository; before it is ever made public that history must be rewritten.
- **One command.** `npm start` → `scripts/start.mjs` (plain JS so it can report an old Node): Node ≥ 22.18, `corepack pnpm install --frozen-lockfile` when needed, build when sources are newer, start, open the browser; a running server is just opened. Verified from a fresh clone in a temp folder (no node_modules, no build): installed, built, served.
- **First run.** A small, skippable tour card beside the scene (remembered per browser); no logs → the demo world with a note naming the two log folders, switching to the owner's world when logs appear.
- Lesson again: the node-strip test caught constructor parameter properties in the new parsers before the server could die on them.

## D25 Cute agents, a first run that works, new features, English (2026-11-05)

Spec `docs/superpowers/specs/2026-11-05-cute-agents-and-first-run-design.md`, plan beside it. Owner asked for cute agents and subagents and an honest look at a first visit; picked direction **B "大头"** from three rendered concepts, **a prop per kind of work** for subagents, all four first-run fixes and all four new features.

- **The character.** `art/character.json` (sizes, face shapes, colours) feeds both `scripts/models/robot.py` (the GLB: big soft head, black screen face with 7 expression groups, headphones, 11 props) and `character/faceSvg.ts` (the 2D face for cards, the mini window, 需要你, the poster), so they cannot drift. `character/rules.ts`: `faceOf` (pose → face; done → happy unless hurt; idle ≥ 60 s → sleepy) and `propOf`/`workOf` (a typed subagent's role, else the work it did most, ties to the earliest, backpack before any). Eyes and antenna are the faction's colour; headphones the faction's on a main agent, the kind of work's on a subagent; the chest light the work now. Sized for the default city camera: main ≥ 40 px, sub ≥ 28 px (measured 55 / 42 on real data). History-step agents stand in a row on the camera side of the task hall (the old ring hid them behind it at the new size).
- **First run.** The tour moves the camera to what each step explains and rings or glows it, the card beside it; it ends in space with the planets pulsing until a city is entered; replay from the settings. The no-logs note is a closable card under the top bar; the city legend starts folded (remembered); the never-filled "等效花费" stat is gone; `/` finds a project by name (prefix, word start, substring).
- **Follow an agent.** A click on a robot (an invisible hit capsule) sets `store.followAgent`; the city camera chases it (the replay follow generalised); the card's facts come from the town's events on the page (`agentFacts`: open tool call, since when, tokens, children, parent), live facts limited to requests in progress. Esc steps back through `store.back()` (follow first); dragging lets go; a robot missing for 3 s lets go.
- **Mini window.** Document Picture-in-Picture (desktop Chrome/Edge only; no button elsewhere): 需要你 rows and working sessions (`miniRows`), a session quiet longer than the live window (10 min) is not "working" — real data had sessions idle for days that never logged an end.
- **Review poster.** Last 7 / 30 / 365 days or all time (`reviewStats`), 1080×1350 PNG (`drawPoster`, which returns every text it drew for the privacy test), over a frame of the universe grabbed in share mode (neutral marks, masked names, no DOM labels). Subagents as a count from the requests (types only where spawn events are loaded).
- **Sounds and celebrations.** Web Audio, off by default, ≤ 1 per 3 s, only for newly waiting / turn done; milestones (10…1000 finished, each 10 % of a shell, a project's first) only when crossed while the page is open, each once.
- **English.** Every page text goes through `i18n/zh.ts` / `en.ts` (a test fails on Chinese elsewhere in `packages/web/src`); the browser decides, the 中文/English button switches and reloads (data-built text is made at load). Words that arrive in the data (野外营地, 都城, "<x> 公会", "接续：") are re-worded at load (`i18n/data.ts`); `RequestRow.gist` became facts (`GistFacts`) the page words. The server words notifications and page-facing errors in the language the page last chose (`settings.lang`), the terminal by `LANG`; masked titles in exports take the export's language. Tests pin Chinese (`LANG=zh_CN` for vitest, `locale: zh-CN` for e2e) and English has its own tests.
- Lessons: a fixed-gap card covered a zoomed planet (gap now from the ring's size on screen); the search box landed on the export button on real data only (tools now share one row); the tour's Esc also left the city through the global `back()`.

## D26 Answer from the page, project overview, owner fixes (2026-11-05)

Spec `docs/superpowers/specs/2026-11-05-decisions-overview-design.md`. The owner asked why two main agents show, what the little cars are, why the poster's "running commands" row breaks, for mini-window rows that take you there, for a needs-you decision answered on the page and sent back to the terminal, and for a project overview. Picked: the hook waits for the page; cars get a meaning; an Overview tab.

- **One robot per agent.** Claude logs every main agent as `main`; the page keys it `main@<session>` (`uniqueAgents`) before any timeline, follow card or history step is built. A replay hides the city's live agents; two live mains name their request.
- **Cars are deliveries.** A request that ends with a product sends a car from the task hall to its house (`deliveriesAt`: 6 s drive, 3 s park); in a replay it runs on the wall clock from the roof (the replay clock stops at its end). The decorative street cars are gone.
- **Poster rows** size the label column by measurement (English labels ran into the bars).
- **Mini window rows** go to the city and follow that session's main agent (`followMain.ts`, shared with the tour); a waiting row opens its decision.
- **Answer from the page.** Spike with a real Claude Code 2.1.317 session in tmux: a `PermissionRequest` hook may wait; the terminal shows its own question meanwhile; `{behavior:"allow", updatedInput:{...input, answers}}` answers an AskUserQuestion; a terminal answer first wins. Built: the adapter keeps a question's options (`AgentTownEvent.ask`, cache v4), 需要你 shows an open question at once in any permission mode, a settings switch installs the `agent-town-ask` hook (Claude matcher `*`, Codex PermissionRequest; curl -m 130), the server holds it only while a page sends heartbeats (from a Web Worker — a busy first frame starved a main-thread timer), at most 120 s, and lets go on answer, "answer in the terminal", a stale heartbeat (25 s), the log showing it answered, or the hook's connection closing. Answers need a token only the page can read (`/api/status`) besides the Host/Origin check. Codex approvals follow the documented schema, untested on a live Codex session. Real run: the shipped hook command, a test server and a headless page answered a real session's question ("→ Full rewrite · Allowed by PermissionRequest hook").
- **Overview.** The city's right panel opens on Overview (requests by kind, finished work by kind, tokens, active days and streak, houses/tents drawn of total, public buildings, streets, work done most, subagents, skills, live now); History is the other tab. A city now opens on the world as it is, not pinned to its last step.
- Lessons: the decision e2e found two real bugs (heartbeat starvation; the no-logs card over 需要你) before it found its own flakiness (SwiftShader's "stable" check — click from inside the page); an open AskUserQuestion was invisible in auto mode because "auto" counted as never waiting.

## D27 Clear names, real scale, a page that steps aside, safer answers (2026-11-07)

Spec `docs/superpowers/specs/2026-11-07-names-scale-polish-design.md`. The owner asked what still needs work for a user; a headless look at the real page found unexplained planet names (都城 / 野外营地, two "field camp"s, "capital capital"), "36811.7M", 需要你 offering "resume" for a session alive in its terminal, panels covering the city, duplicate Overview chips, "other St", labels cut at the screen edge, and a 20-house cap that made a 138-piece project look like a 20-piece one. Picked: all four groups; suburbs of tiny houses; rename + hide + merge; 万 / 亿.

- **Names.** The capital (tool folders) and the field camp (temp folders) say what they hold. `~/.agent-town/towns.json` keeps names, hidden towns and merges (`townPrefs.ts`: wrong shapes dropped, merge chains followed, loops / missing targets / capital / field camp dropped so requests never vanish); `POST /api/towns` (one change per call; a loop is refused, also in the reload window). Names and hidden apply when towns are built; a merge moves events right after load, before requests, towns and attention are built. Overview: ✎ rename, hide, merge into…; Settings undoes. A hidden town has no planet but keeps a city search can open (`Galaxy.hiddenPlanets`, `planetOf`). Share mode masks the folder name and hides the controls.
- **Numbers.** `formatCount(n, units)`: k/M/B, 万/亿; a value that rounds up takes the next unit.
- **The page steps aside.** A camera view offset shifts the city left by half a right panel while one is open (eased; cleared on leaving — the galaxy shares the camera). 需要你: the name has the row; the action follows `needAction` (decide / answer in the terminal / turn on page answers / copy resume only for finished or failed turns). Labels whose point is on screen stay whole on screen.
- **Suburbs.** Every finished piece not drawn as a house is a tiny house on the outskirts (7 per hex, ring by ring, spread evenly, by finish time, ≤ 600), roof in its product colour, two instanced meshes; history and replays grow them; hover/click as a house; a History step on one rings it. Overview: big houses · suburbs.
- **Safer answers.** Multi-select + Other sends both; an unparsable AskUserQuestion is left to the terminal; the hint says Allow approves the action.
- Lessons: the e2e's synthetic projects first landed in the field camp (macOS temp) and then in the agent-town repo (git root wins) — each project needs its own `git init` outside temp. The merge-loop race only shows with a slow load (real logs take 2–17 s to reload).

## D28 No field camp (2026-11-07)

The owner did not see what "野外营地 / field camp" was for: it looked like a stand-in for many projects. Checked on the real data: of its 876 requests only 73 had started in a temp folder; 584 had started in a real project folder and 220 at home. Causes: any temp-folder file (renders, scratchpads) placed a request in the outpost when nothing else was recognised (Codex's `exec` tool wraps its commands and patches in JS, so their paths are not read); and Claude's logged projectId is where the *session* first started, so a session begun at home and moved into a project counted as home. Picked: remove the field camp.

- Temp and loose folders are no town: a file there gives no vote. A request goes to the real project it touched; else to its first turn's own working folder (`task_start.cwd`, else the session's); a project there beats the tools' by-product files (memory, settings → capital votes); work that belongs to no project (started at home, in a loose or temp folder, or in a tool folder) goes to the capital, whose note now says so.
- Real data: the field camp's 876 requests went to slides-to-video 274, the capitals 365, topic-to-video 91, career_product 50, Explore App 22, slides_maker 28, …; 179 more moved from the capital to their projects (panda-tok +22). Planets with ≥ 2 finished: 29 → 43 (many one-off deck folders; hide or merge them from Overview).
- Not done: reading paths inside Codex's `exec` tool (its requests now fall back to their working folder, which was right in every case sampled).
- Lesson: a world.spec step timed out three times in a row only on a cold dev server (space's modules built on the first way back under SwiftShader); warm it passed — the wait now matches the test's other slow-renderer waits.

## D29 One-off folders draw no planet (2026-11-07)

After D28 the Codex system grew to 35 planets, most of them folders worked on once (a deck or a talk made in an afternoon). The owner: don't show one-off small folders. On the real data the line was clear: every such folder had all its activity on one calendar day (chengdu-travel 9 finished, slidemaker_tutorial 7, tokyo_city 3 …), every real project several (lifeos 7 days, career_product 21).

- A planet needs `MIN_PRODUCED` finished pieces **and** activity on `MIN_DAYS` = 2 local calendar days, or work going on now (so today's new project shows while it runs). Others are counted in the shells and the "not shown" line, which now says "small or one-off".
- Real data: 43 planets → 21 (Claude 8, Codex 13); 53 projects counted, not drawn. Two-day folders (slidemaker-pitch, medical-ai-agents) still show; hide or merge them from Overview.
- Lesson: two e2e failures right after a build with a real-data server and screenshots running were load, not code — they passed on a quiet rerun; judge e2e on a quiet machine.
