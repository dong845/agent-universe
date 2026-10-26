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
   (screen and browser operation). With them, the work site has 8 tool buildings around it.
3. **"Calls not in the transcript"** (D5): shown on the 2D dashboard only. They have no task or step,
   so placing them in the world would break "every element maps to real data".
