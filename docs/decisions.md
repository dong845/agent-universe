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
