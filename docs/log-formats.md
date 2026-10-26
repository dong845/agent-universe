# Log formats — phase-0 findings

Measured on 2026-10-26 against the logs on this Mac. They are not taken from documentation.
Re-run the probes after every tool upgrade:

```
python3 scripts/probe/probe_claude.py      # ~30 s over ~1.9 GB
python3 scripts/probe/probe_codex.py
python3 scripts/probe/make_fixtures.py --out fixtures   # text-free copies, see "Fixtures"
node scripts/parse.ts --against probe-claude.json,probe-codex.json   # adapters vs probes (D5)
```

The probes take `--json=<file>` to write the totals that `parse.ts --against` compares.

What was scanned:
- **Claude Code**: 10 main sessions and 630 subagent files under `~/.claude/projects/`.
  Versions span roughly 2026-09 to 2026-10.
- **Codex**: 476 rollouts under `~/.codex/sessions/`, CLI 0.141 to 0.154, dated 2026-04-19 to 2026-10-03.

---

## Claude Code

### Q1 — Where subagent records live

**Separate files.** No line inside a main session file has `isSidechain: true` (0 of ~2.4 M lines).
Subagents sit next to the session:

```
<project>/<sessionId>.jsonl                                  main agent
<project>/<sessionId>/subagents/agent-<agentId>.jsonl        isSidechain:true, agentId on every line
<project>/<sessionId>/subagents/agent-<agentId>.meta.json    {agentType, description, toolUseId, spawnDepth, model, requestShape}
<project>/<sessionId>/subagents/workflows/wf_<id>/agent-<agentId>.jsonl   agents started by the Workflow tool
```

The adapter should still accept in-file `isSidechain` lines, because older versions wrote them.

### Q2 — Linking a subagent to the call that spawned it

- **The spawn tool is `Agent`, not `Task`** (456 calls, 0 `Task`). Role rules must match both names.
- **Every one of the 630 subagent files is linked:**

  | How it is linked | Files |
  |---|---|
  | `meta.json.toolUseId` equals an `Agent` call id in the main file | 452 |
  | `toolUseId` equals an `Agent` call id inside another subagent file (`spawnDepth: 2`, nested) | 32 |
  | Lives under `subagents/workflows/wf_<id>/` (attach to the `Workflow` call, not to an `Agent` call) | 146 |

- **Parallel spawns**: one assistant message is written as **one line per content block**, all sharing one
  `message.id`. To find agents spawned in parallel, group `tool_use` blocks by `message.id`, not by line.

### Q3 — Does the spawn result carry token and time totals?

**Not the immediate result.** All 453 `Agent` tool results here were background launches
(`status: "async_launched"`) with no token fields.

The totals arrive later, in a `<task-notification>` user message. 140 notifications carried
`<usage><subagent_tokens>`, `<tool_uses>` and `<duration_ms>`; the other notifications are for
background shell jobs and similar.

These totals are useful for cross-checking only. **The per-step source of truth is the subagent's own file.**

### Q4 — Is usage repeated when a message is split across lines?

**Yes.** Of 75,996 lines that share a `message.id` with an earlier line, every difference is
`(input same, output up, cacheRead same, cacheWrite same)`. Only `output_tokens` grows; the last line holds the final count.

- **Rule**: dedupe by `message.id` and keep the line with the largest `output_tokens`.
- **Size of the error otherwise**: summing every line roughly doubles output and cache-read
  (031df001: 2.21 M naive vs 0.81 M deduped output).

**Reconciliation, against the `cost-state` record.** This is the only official total inside the log:
`totalCostUSD` plus per-model `modelUsage`.

- On the main model of a clean session, cache read, cache write and output agree to 0.5–1.2%.
  For example, 031df001 opus-5-5: cacheRead 322.36 M vs 324.09 M; output 795 k vs 805 k.
- **The plan's "< 1% vs official" acceptance is not reachable from transcripts alone**, for four reasons:
  1. **Calls that never reach the transcript.** Haiku side calls (titles, classifiers) appear in
     `cost-state` but never in the transcript. So do the compaction summary calls (one compaction
     here read 966 k tokens), and some input on the main model.
  2. **`cost-state` is per process, not per session.** It carries a `startTime`. A resumed session
     only covers the latest process: 6207e8ee shows 4.5 M cache read vs 18 B in its transcript.
     Two sessions run in one process share one snapshot (2866adfa and fe70a886 have the same `startTime`).
  3. **Model names differ.** `cost-state` keys carry a `[1m]` suffix, for example
     `claude-opus-5-5[1m]`, that the transcript's `message.model` lacks.
  4. **`input_tokens` is not comparable.** It is tiny in transcripts (cache dominates), so a
     relative error on it is meaningless.

- **Proposal**: measure the acceptance per model on the main model, over cacheRead + cacheWrite + output,
  for sessions run in a single process. Show the rest in the UI as "calls not in the transcript".

### Q6 — Compaction

- **The marker**: `{"type":"system","subtype":"compact_boundary","compactMetadata":{trigger, preTokens,
  postTokens, durationMs, …}}`, followed by a `user` line with `isCompactSummary: true`.
- 61 compactions were found, all `trigger: "auto"`.
- `preTokens` and `postTokens` give the context before and after the compaction, which is the
  "backpack emptied" animation input.

### Q7 — When usage is written

- **Timing**: each content block is written when it completes, carrying the response's usage so far.
- **What is known when**: input and cache numbers are final from the first block; output is final only on the last block.
- **Refresh granularity is one content block, not one model call.** "Current spend" can tick while a
  response is still being generated. Mark the output figure as provisional until the next message starts.

### Other records worth using

- **`system/turn_duration`**: `durationMs` per user turn. This gives task duration without pairing events.
- **`last-prompt`, `ai-title`**: a ready-made task title.
- **`toolUseResult.status` / `is_error`**: tool errors.
- **`permissionDecision`**: denied tool calls.
- **Line kinds the adapter must skip**: `attachment`, `file-history-*`, `queue-operation`, `api-request*`
  and the many bookkeeping kinds. These are most lines by count.

### Copied records — found while building the parser

Some records appear in more than one file, as copies.

- **Between subagents.** Three worktree subagents, each spawned by its own `Agent` call, share 49 message ids:
  - the later files open with a copy of the first agent's history;
  - in one case the copy holds the *longer* `output_tokens`, because the original was cut mid-stream.
- **Between sessions.** A continued session (`continued-in` record: 2866adfa → fe70a886) opens with
  477 records copied from the session it continues. That is 36.6 M cache-read tokens counted twice
  if summed naively.

**Rule**: event ids come from the API message id, the tool id or the record uuid, never from the
file. Within a session, the max `output_tokens` per message id wins. Across sessions, the session
that started first owns a record, and copies are dropped (decisions D9).

### Retention — not in the plan, affects "history backfill"

- **What is left**: only 10 main sessions remain here; the oldest was last modified 2026-10-08.
- **The setting**: `cleanupPeriodDays` is unset in `~/.claude/settings.json`.
  Claude Code deletes transcripts older than that period (the documented default is 30 days; not verified here).
- **Consequence**: backfill cannot see further back than the retention window. Agent Town has two options:
  - keep its own copy of derived events in SQLite (it already plans to), and say so in the UI;
  - offer to raise `cleanupPeriodDays` at `install-hooks` time.

---

## Codex

### Q5 — `token_count` semantics

- **The record**: `event_msg/token_count.info` = `{total_token_usage, last_token_usage, model_context_window}`.
  Each usage object holds `input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens`.
- **`total_token_usage` is cumulative per rollout.** It never decreased in 14,483 changes.
- **`last_token_usage` is the per-call delta.** Summing it over the records where the total changed
  equals the final total in **436 of 436** files.
- **Duplicates**: identical consecutive snapshots occur and must be skipped.
- **Empty records**: 33 records have `info: null`; ignore them.
- **Context window is included**: `model_context_window` is 258,400 for most calls, 353,400 for some.
  So `contextMax` comes free.
- **Cut per task by position.** `token_count` events fall between `event_msg/task_started` and
  `task_complete`. 2,829 turns had at least one; 48 had none (aborted or empty).
- **Newer format, CLI 0.154**: a `token_usage_record` line carries `turn_id`, `turn_token_usage` and
  `thread_token_usage` directly. Use it when present.

### Q6 — Compaction

A `compacted` record (111) and an `event_msg/context_compacted` event (99).

### Subagents — the plan assumes Codex has none; it does

- **Spawn tool**: `spawn_agent` (with `wait_agent`, `list_agents`, `interrupt_agent` and `close_agent` around it).
- **The child is its own rollout file.** Its `session_meta` has `parent_thread_id` and
  `source: {"subagent": …}`. All 85 child rollouts found here link to a parent rollout that is present.
- **Consequence**: the Codex adapter maps these to the same `agent_spawn` / `agent_return` events, and
  Codex gets scaffolding too. The plan's "Codex: no scaffold" and "commander changes outfit" rules
  become the fallback, not the default.

### Guardians

`source.subagent.other == "guardian"` (73 rollouts) is Codex's automatic approval reviewer.

- **One guardian is long-lived**: it can be created before the parent's first task and serve several tasks.
- **Spawn link**: it is never spawned by `spawn_agent`, so it has no spawn call to link to.
- **Spawned subagents**: only 12 rollouts are real `spawn_agent` children (`source.subagent.thread_spawn`).
  Of 13 `spawn_agent` outputs, 2 name the child (`agent_id`); newer ones return only `task_name`.

### Tool names — the role table needs updating

- **Shell commands** run through `exec_command`, with the command in `arguments.cmd`, plus `write_stdin`
  for interactive input. There is no tool called `shell`.
- **Other tools seen**: `exec` (custom tool, 4,745 calls), `apply_patch`, `update_plan`,
  `web_search_call`, `view_image`, `imagegen`, and computer-use style tools (`click`, `type_text`, `get_app_state`).
- **What the role rules must change**:
  - The Codex role rules must parse `arguments.cmd` for `cat / rg / grep / ls / find / sed -n` and for test runners.
  - The map should give the image tools and computer-use tools a role.

---

## Corrections to the plan (PDF, 2026-10-25)

| Plan says | Measured | Change |
|---|---|---|
| Subagent spawned by `Task` | Tool is `Agent` | Match both |
| Subagents: in-file `isSidechain` or separate files | Separate files + `meta.json.toolUseId`; also `workflows/` dirs | Add the workflow level to the hierarchy |
| Task result may carry token totals | Async launch; totals arrive in `<task-notification>` | Use the subagent file; the notification is a cross-check |
| Codex has no subagents | `spawn_agent` + child rollouts with `parent_thread_id` | Scaffolds for Codex too |
| Codex shell tool `shell` | `exec_command` (`arguments.cmd`), `exec`, `write_stdin` | Update `roles.json` |
| Token totals < 1% vs official | Transcripts miss side and compaction calls; `cost-state` is per process | Per-model, main-model acceptance; label the gap |
| Usage written after a model call | Written per content block; output grows | "Provisional" output in hover cards |
| Backfill scans all history | Claude keeps ~30 days | Persist events; offer the retention setting |
| "5 questions" (next steps) | The list has 7 | — |

## Fixtures

- **What is in `fixtures/`**: produced by `make_fixtures.py`, and git-ignored until reviewed.
- **How the text is removed**: every string becomes `<length>`, except structural fields (types, tool
  names, models, ids, timestamps). Paths, including dict keys that are paths, become `h:<sha256-12>`.
  Numbers are kept.
- **Checks run**:
  - **Leak scan**: no username, home path, file extension, API-key or email pattern.
  - **Token totals**: `probe_claude.py` on the fixtures reproduces the same deduped token totals as on the originals.
- **The set**:
  - **Claude**:
    - one session with 5 subagents, a compaction and tool errors (6.3 MB);
    - one without subagents, with a compaction (0.6 MB).
  - **Codex**:
    - a parent that spawns a subagent, plus its child;
    - a compaction;
    - an aborted turn;
    - the new `token_usage_record` format;
    - a plain session.
- **Codex guardian**: one guardian rollout with the thread it serves.
- **Gaps**:
  - No Claude fixture has a workflow agent or a nested (`spawnDepth: 2`) agent. Only the 354 MB and
    858 MB sessions contain them, so a trimmed slice is needed.
  - Hook events are not covered; that needs `install-hooks`.
