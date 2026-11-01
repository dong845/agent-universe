# Attention and sharing — design (2026-11-01)

## Why

Agent Town (the star-system world, D18–D21) is a picture of what your agents have built. Other tools in
this space are mostly live status screens (Pixel Agents, claude-office, two other repos also named
"agent town"). They have two things users clearly value that we lack:

1. **Knowing when an agent needs you**, without staring at terminals.
2. **Something to show other people.**

The owner chose these two directions to make Agent Town attractive as a product. Positioning stays
"a universe your AI work builds", not "another live monitor": the alert layer serves that world, it does
not replace it.

## Goals

- A. **"Needs you" alerts**: Agent Town notices, within seconds, when a Claude Code or Codex agent may be
  waiting for an approval, has finished its turn, or stopped on an error, and tells the owner in the page
  and through a macOS notification.
- B. **Resume**: from an alert or a request diary, one click copies the command that reopens that session.
- C. **Replay video**: record a request's city replay as MP4 (GIF optional), labels and bubbles included.
- D. **Interactive share page**: export one self-contained HTML of the world (space + cities) that someone
  else can open and rotate, with private text hidden by default.

## Non-goals

- Approving or answering an agent from Agent Town (no remote control of sessions).
- Cost in dollars (still "未配置价格").
- Hosting or uploading anything: every export is a local file the owner chooses to send.
- New agents beyond Claude Code and Codex.
- Clicking a macOS notification to open the page (it needs an extra helper install; the owner declined).

## Anti-goals (would make this a failure even if it works)

- An alert that cries wolf so often the owner turns it off. "Maybe waiting" must be labelled as a guess.
- Any export that leaks a request title, a file path, a username or a project name the owner did not
  switch on.
- Changing `~/.claude/settings.json` or Codex's config without an explicit toggle, a backup and an undo.
- An export showing the official Claude/OpenAI marks (they are for local use only, D21).
- Slowing the world down: the space view stays at 60 fps on a real GPU while the watcher runs.

## Constraints

- Local only: server binds loopback and checks Host/Origin (existing). Hook calls arrive on that server.
- Real logs, the cache and real-data screenshots never go into git or tests; tests use the demo payload
  and synthetic log files.
- Exports never include raw events, prompts, tool inputs or outputs.
- Browser support: system Chrome (the owner's browser). Other browsers degrade (e.g. WebM instead of MP4),
  they don't break.

## A. "Needs you" alerts

### A1. Watching

The server watches the Claude (`~/.claude/projects`) and Codex (`~/.codex/sessions`) roots. A changed file
triggers a debounced re-load of its unit through the existing per-unit cache (`load.ts`), then a fresh
payload. The page receives updates over a server-sent event stream (`GET /api/stream`): a `world` event
when the payload changed and an `attention` event whenever the attention list changes. `/api/refresh`
stays. The page applies a new payload without losing camera, focus, city or selection.

### A2. States

Per live session (a session whose files changed within the live window), the server computes at most one
state, from its latest events:

| State | From the logs | From a hook (when installed) | Notify by default |
|---|---|---|---|
| `maybe-waiting` — "可能在等你授权" | a `tool_start` of a tool that can need approval, with no `tool_end` for ≥ 20 s (rules below) | — | yes |
| `waiting` — "在等你授权" | — | Claude `Notification` hook (permission prompt) | yes |
| `turn-done` — "本轮完成，等你回复" | the session's last task ended (`task_end`; for Claude this is the `turn_duration` system line) and nothing newer | Claude `Stop` hook | no (in-page only; toggle) |
| `error` — "出错停止" | the session's newest event is an `error` (Claude API-error message) and nothing newer for 10 s | — | yes |

`maybe-waiting` rules, to keep it from crying wolf:
- Never for subagent spawns (Claude `Agent`/`Task`, Codex `spawn_agent`) — those run long by design and
  their own calls are watched instead.
- Never for read-only tools that do not prompt by default (Claude `Read`, `Grep`, `Glob`, `LS`, `TodoWrite`).
- Never while the session's latest recorded permission mode (Claude `permission-mode` lines) is
  `bypassPermissions`, or for Codex when the turn context's approval policy is `never`.
- Everything else (shell, edits/writes/patches, web fetch, MCP calls) counts. A long build still trips it;
  that is why it is labelled "可能".
- Codex `turn_aborted` is *not* an error alert: it is almost always the owner pressing Esc.

A state clears as soon as a newer event arrives for that session (the call returns, a new turn starts), or
after the session leaves the live window. Thresholds (20 s, live window) live in one config object. The
"maybe" label is always shown for the log guess; with a hook installed, a hook `waiting` replaces a
`maybe-waiting` for the same session.

**Codex**: use whatever Codex exposes (its `notify` program and/or hooks — verify the current mechanism
at build time against the installed Codex version, and record it in `docs/log-formats.md`). If none
reports an approval wait, Codex uses the log guess only.

### A3. The hook toggle

A settings panel switch "精确授权提醒（安装 hook）". On:
1. Back up `~/.claude/settings.json` to `settings.json.agent-town.bak` (never overwrite an existing backup
   without keeping it).
2. Merge (never replace) hook entries that POST the hook's JSON to Agent Town with a tiny command that
   fails silently and fast (≤ 1 s timeout) when Agent Town is not running — a hook must never block or
   slow the agent. The command reads the port from `~/.agent-town/port` (written by the server at start;
   default 5182), so a server on another port needs no re-install.
3. Show exactly what was added.
Off: remove only our entries (identified by a marker), leave everything else as is. Same pattern for Codex
if A2 finds a mechanism. The server accepts `/api/hook` only from loopback.

### A4. In the page

- A "需要你" list at the top of the screen: faction mark, town name, state, how long ago. Hidden when empty.
- The planet of a session in that list gets a pulsing ring in space; the city's hall robot already raises
  its hand.
- Clicking an entry flies to that town and opens the request's diary.

### A5. macOS notification

The server posts a notification via `osascript` (`display notification`): title "Agent Town", text
"<town> · <state>". At most one per session per state; a session's repeated state does not re-notify.
Settings: on/off overall, and "本轮完成也通知" (default off). Clicking the notification does nothing
useful (stated non-goal); the text says where to look.

### A6. Resume

In the diary and in each list entry: "复制恢复命令".
- Claude: `cd <session cwd> && claude --resume <sessionId>`; the session cwd comes from the log's `cwd`
  field (the server sends it with the request/session data; paths stay on this machine).
- Codex: `codex resume <threadId>`; prefix `cd <cwd> &&` if the rollout records one.
Copied with the Clipboard API; a toast confirms.

## B. Sharing

### B1. Privacy mask (shared by C and D)

One function turns the payload into a shareable one, by **allowlist**: the shared payload is built
field by field from a list of fields allowed to leave the machine; any field not on the list is dropped
(so a field added later is private until someone allows it). Default "hide":
- Request titles → their kind and size ("完成作品 · 12 步", "调查 · 30 次调用", "问答").
- Project/town names → planet code names (e.g. "Kepler-7c"), from an HMAC of the town key with a
  per-install secret kept in `~/.agent-town/` (stable across one owner's exports, not guessable from a
  project name).
- Paths, usernames, session ids, cwd, any free text from the logs (titles, `continues`, agent task
  descriptions, tool targets) → removed.
- Building tags keep their plain kind names (写代码, 读资料 …); robot bubbles show only the fixed
  category phrases `activityOf` already produces ("写代码", "思考", "派出子代理" …), which never contain
  log text.
- Counts, tokens and timing stay (they are the point of the picture).
The export dialog has one switch, "显示真实名称", default off, with a line saying what it reveals.
A test feeds a payload whose every text field holds a marker string and asserts no marker survives.

### B2. Exports use our own emblems

Exports (video and share page) swap the official marks for neutral faction emblems (a sunburst for
Claude Code, three rings for Codex, as in D18), both in 3D and in label badges. The local page keeps the
official marks.

### C. Replay video

- A "录制" button on the replay bar opens a small dialog (the "显示真实名称" switch, MP4/GIF), then records
  **the live scene the owner is watching**: the page switches into share mode (mask + our own emblems)
  for the duration, with a banner "录制中 · 已隐藏真实名称" outside the recorded area, and switches back
  after. What the owner sees is exactly what goes into the file. The replay restarts from its beginning
  at the current speed and stops at its end or on "停止", capped at 60 s.
- Frames come from the WebGL canvas composited with the label layer (planet/town labels, building tags,
  robot bubbles), redrawn into a 2D canvas each frame from the same data the DOM labels use. Output via
  `MediaRecorder`: MP4 (H.264) where Chrome supports it, WebM otherwise. GIF: optional, from the same
  frames at reduced size/fps, client-side.
- While recording: the mask (B1) and our own emblems (B2) are on; UI chrome other than labels is not in
  the video; a small watermark "Agent Town" in a corner.
- Output file name `agent-town-<code name>-<date>.mp4`, downloaded by the browser.

### D. Interactive share page

- "导出分享页" in the space view. Produces one `.html` file that opens offline: the app bundle in
  "viewer mode", the masked payload, the models (city kit, robot, our own emblems) inlined.
- Viewer mode: space and cities, hover cards with masked text, no diaries, no live/alerts, no settings,
  no network calls.
- The owner can tick up to 5 requests to include as replays (their events masked and reduced to what
  the city replay needs: kinds, times, roles, buildings — no tool inputs, outputs or paths).
- The server assembles the file from the production build (`packages/web/dist`), the way `scripts/serve.ts`
  already serves it; from the dev server the button explains that export needs `node --run start`.
- Size: the dialog shows the size before saving; 15 MB is a target, 40 MB a hard limit (export refuses
  and says which part is large).

## Decided by the owner

- Signal: log guess by default, optional hook toggle with backup.
- Alerts: in the page + macOS notification (no sound).
- Sharing: replay video (MP4/GIF) and interactive share page first; no poster this round.
- Privacy default: hide titles and paths, code names for projects.
- No helper install for clickable notifications.

## My calls (the owner can overrule)

- Server-sent events for updates; debounced reload via the existing cache.
- `turn-done` notifies in-page only by default.
- Exports use our own emblems.
- 20 s threshold for "maybe waiting".
- Viewer mode excludes diaries entirely.
- Recording switches the live view into share mode (what you see is what is recorded).
- "Maybe waiting" skips subagent spawns, read-only tools and bypass-permission sessions; Codex aborts
  are not error alerts.
- Code names come from a per-install secret: the same town has the same code name in every export.
- Share page: at most 5 replays, 40 MB hard limit, built from the production build only.

## Left to the builder

- Debounce interval, SSE reconnect logic, how the page merges a new payload.
- Code-name scheme (must be stable and non-reversible).
- GIF encoder choice; MP4 bitrate.
- How the share page is packaged (separate Vite entry or a viewer flag), as long as it is one file.
- Exact settings panel layout.

## How we'll know it works

- Synthetic log files (written by the test) drive each state transition, including clearing.
- A hook POST flips `maybe-waiting` → `waiting`; the toggle's install/uninstall round-trips a sample
  settings file byte-for-byte except our entries.
- The mask test (B1) with marker strings.
- A recorded video from the demo world is opened and looked at: labels present, no official marks, no
  real names.
- The share page opens from `file://` with the network disabled and renders space and a city.
- Space view still 60 fps (headless Metal, as in D20) with the watcher running.
