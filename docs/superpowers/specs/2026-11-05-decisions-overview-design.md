# Answer from the page, a project overview, and fixes from the owner's look — design (2026-11-05, D26)

The owner looked at D25 and asked: why are there two main agents when following one; what the little cars
are; the "running commands" row of the poster is laid out wrong; a working row of the mini window should
take you there; when a session (slides_maker) needs a decision, the page should show the options and send
the choice back to the terminal — not offer resume/replay; and a planet (a project) should have an overview
of its scale. Picked: **the hook waits for the page**, **cars get a meaning**, **an Overview tab**.

## Facts checked (2026-11-05)

- Every Claude Code main agent is logged with agentId `main`. A town with two sessions at once merges them
  into one robot; a replay started in a live city draws its own main next to the live one.
- The cars (`HoverCars`) glide along streets as decoration; they carry no information.
- English poster: "Running commands" is wider than the label column and runs into its bar.
- A question with options is an `AskUserQuestion` tool call; its full input (questions, options,
  multiSelect) is in the transcript.
- Spike with a real Claude Code 2.1.317 session in tmux and a project `PermissionRequest` hook (matcher
  `AskUserQuestion`) that waited 8 s and answered `{behavior: "allow", updatedInput: {...input, answers:
  {question: label}}}`: the terminal showed its own question during the wait; the hook's answer was applied
  ("Pick a color → Blue · Allowed by PermissionRequest hook"). Answering in the terminal first wins (the
  hook's later answer is ignored). Hook input: session_id, tool_name, tool_input, transcript_path, cwd,
  permission_mode (no tool_use_id).
- Codex `PermissionRequest` hooks return `{behavior: "allow" | "deny"}` (schema; not tried on a live
  session here).

## A. Fixes

- **A1 One robot per agent.** On the page, a Claude main agent's id becomes `main@<sessionId>` (and a
  subagent's parent likewise) before timelines are built, so two sessions in one town are two robots; when a
  town shows more than one main agent, each bubble names its request. While a replay plays in a city, the
  live agents of that city are hidden.
- **A2 Cars are deliveries.** A car = a request that just finished with a product: when it ends (on the
  scene clock, live or in a replay) a car drives from the task hall to that request's house (or its street)
  in ~6 s and parks there briefly, then fades. No finished work, no cars. The decorative street cars go.
- **A3 Poster rows.** The label column is as wide as the longest label (measured), the bars start after
  it, and labels shrink to fit when needed.
- **A4 Mini window.** Clicking a working row brings the page forward, enters that project's city and
  follows its main agent (as the tour does); clicking a 需要你 row opens its decision (B).

## B. Answer from the page

- **B1 What is pending.** For Claude, an `AskUserQuestion` call (questions with options) or a permission
  prompt (a tool call to approve); for Codex, an approval. The page learns of it two ways: from the logs (an
  open `AskUserQuestion` now keeps its questions in the event, `AgentTownEvent.ask`; parser cache version
  bumped) and from the hook (B2), which also makes it answerable.
- **B2 The hook.** A new switch per agent, "在页面上回答（安装 hook）", adds a `PermissionRequest` hook
  (Claude: matcher `*`; Codex: its PermissionRequest), marked `agent-town-ask`, written like the existing
  hooks (backup first, removable). The hook is `curl` posting its input to `/api/ask?src=…` with a long
  timeout; the server holds the request open **only while a page of Agent Universe is open and visible**
  (the page sends a heartbeat every 10 s; stale after 25 s). Otherwise it answers at once with nothing, and
  the terminal asks as usual. Held at most 120 s (hook timeout 130 s). No server running → curl fails →
  `|| true` → the terminal asks as usual.
- **B3 The decision panel.** A 需要你 row with something to decide shows "选择"/"Decide" instead of
  leading to resume/replay. The panel shows the session's project, the question(s) with each option's label
  and description (single or multi select, plus "其他" free text), or for an approval the tool and what it
  will run, with Allow / Deny. Submitting answers the held hook: Claude `{behavior: "allow", updatedInput:
  {...input, answers}}` for questions, `{behavior: "allow"|"deny"}` for approvals; Codex allow/deny. "在终端里
  回答" releases the hook at once (empty answer → the terminal keeps asking). Without the hook the panel
  still shows the question and options from the logs and says how to answer from the page.
- **B4 Closing.** When the logs show the call got its result (answered in the terminal) the pending item
  and the held hook are released; the panel closes with a note.
- **B5 Safety.** Answering approves actions on the owner's machine, so `/api/ask/answer` accepts only the
  page: same-origin check as the other routes, plus a random token created at server start and given to the
  page by `/api/status` (another site cannot read it). The hook route stays loopback-only as today.
- **B6 Mini window and notifications.** A pending decision appears first in the mini window with a
  "选择" button; the macOS notification says "需要你选择".

## C. Project overview

- **C1** The city's right panel has two tabs, **概况 / Overview** and **历史 / History**; a city opens on
  Overview. Overview, from the town's requests and layout: requests (produced / investigation / Q&A),
  finished work by kind, tokens, active days, first and last activity, longest streak; what is built
  (houses drawn of finished, tents, public buildings with counts, streets); the most-used kinds of work and
  subagent count; skills used; live now. Each number names what it counts.

## Non-goals

Typing into terminals; answering free-form prompts that are not a tool call; changing how the terminal
shows questions; remote access.

## Calls I made

- Cars only for finished products (the thing the city builds); live and replay only.
- The page heartbeat decides whether the hook waits, so nobody waits on a page that is not open.
- Codex approvals use the documented schema and are labelled untested on a live session.

## How we'll know

- A1: unit test of the id remap (two sessions → two actors); e2e: a replay in a live city shows one main.
- A2: unit test of which deliveries are on the road at a time; a look at a live city.
- A3: poster texts never overlap bars (drawn rectangles vs text widths in a stub canvas) in zh and en.
- A4: e2e on the mini window: click a working row → city entered, following.
- B: server unit tests (hold only while watched, release on answer / timeout / log result / terminal
  button, token required, hook install/uninstall); a real run again with the tmux spike against the real
  server: question shown on the page, answered there, the session continues with that answer.
- C: unit test of the overview numbers on a fixture; a look at a real city.
