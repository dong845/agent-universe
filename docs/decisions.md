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
