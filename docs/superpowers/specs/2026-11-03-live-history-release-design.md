# Live updates, truer history, ready for others — design (2026-11-03)

Owner picked three directions after a review of what to improve: **only update what changed** (then a
real live clock), **a more accurate history**, and **ready for other people**. Decided with the owner:
name **Agent Universe · 智能体宇宙**; official marks **not in the repo**, an opt-in local download; install
= **clone + one command** (no publishing); untitled requests get **a sentence from the logs' facts**.

## A. Only update what changed, then live

Measured now (real record, 2,074 requests, 336k events): a change in one huge live session re-parses
the whole file (a 202 MB log: ~9 s; a reload 14–33 s overall), and applying a newer world rebuilds the
page's whole world (~200 ms frame). Updates are throttled to hide this, so the page runs 1–2 min behind.

- **A1 Tail parsing.** The two adapters become resumable: a parser keeps its state and the byte offset
  it reached per file; when a file only grew, only the new complete lines are fed; the end-of-file
  finishing (open tasks etc.) is computed on top of the state each time without changing it. A file
  that shrank, was replaced (its first bytes differ) or a unit whose file set changed is parsed again
  from the start. Proof: on synthetic logs, feeding a file split at every line boundary gives exactly
  the events of one full parse (Claude, Codex, subagent files, continued sessions).
- **A2 Incremental page rebuild.** Towns and planets whose requests did not change keep their layout,
  planet and blocks (same objects), so React and three.js redraw only what changed. Target: applying a
  newer world costs < 50 ms; then the 30 s throttle drops to ~5 s.
- **A3 Live clock.** On real data the clock follows now by default (the "实时" button becomes real): the
  scene shows `now − lag` where lag is the measured data latency (a few seconds), so agents move
  continuously in real time. Scrubbing the time bar leaves live mode; "实时" returns to it. Replaces the
  catch-up of 2026-11-03, which stays only as the fallback when data runs late.

## B. A truer history

- **B1 Counts as of a step.** Each request row carries its tool calls per kind of work
  (`RequestRow.work`). At a history step the public buildings show the town's counts as of that moment
  (requests ended by then), and a building whose count was still under the build threshold (5) is not
  drawn. The Q&A board counts Q&A requests ended by then.
- **B2 The step's own house.** If the city does not draw the chosen step's house (20-house cap), it is
  drawn for the step on a free lot by its street, marked as shown only for this step.
- **B3 A sentence for untitled requests.** Built by the server from the request's own events, facts
  only: what kind of work dominated and on what, e.g. "改了 3 个文件：src/a.ts、b.ts…", "跑命令：git
  status", "读了 12 个文件（src/…）", "调查：搜索 X". Stored as `RequestRow.gist`; shown where a title
  would be, in grey; local only — dropped from any export (allowlist) and from share mode.

## C. Ready for others

- **C1 Name.** Everything user-facing says Agent Universe / 智能体宇宙: page title, top badge, share page,
  watermark, export file names (`agent-universe-…`), README, package name. Internal paths keep their
  names for compatibility (`~/.agent-town/` data folder, the `agent-town-hook` marker, the cache).
- **C2 Marks.** `art/logos/*.svg` and `emblems.glb` leave the repository. A settings switch
  "下载官方标志（仅本机显示）" makes the server fetch the two SVGs from Wikimedia Commons into
  `~/.agent-town/logos/`; the page then builds the solid 3D marks in the browser from the SVG (extruded
  and bevelled like the Blender ones) and uses them only on this machine; exports keep the neutral
  marks. Without the download everything uses the neutral marks. The owner's machine gets the download
  done once so it looks as now. Note: the marks stay in the git history already pushed; before the
  repository is ever made public that history has to be rewritten (to be asked then).
- **C3 One command.** `npm start` (also `node --run start`) checks Node ≥ 22.6, installs dependencies
  with the pnpm that corepack ships (when `node_modules` is missing or stale), builds when the build is
  older than the sources, starts the server and opens the browser. Clear messages when something is
  missing. No publishing anywhere.
- **C4 First run.** A short tour on first visit (what a star, planet, Dyson panel, city, robot, 需要你,
  历史 mean), skippable, remembered. With no logs found, the demo world opens with a banner saying so
  and where Agent Universe looks for logs.

## Non-goals

Publishing to npm or making the repo public; changing data folders; cost pricing; an LLM summary.

## Calls I made (owner can overrule)

- Tail parsing replaces whole-file re-parse; the full parse stays as the fallback and the test oracle.
- Live lag = measured latency, not a fixed number; scrubbing leaves live mode.
- The step's own house is drawn temporarily rather than re-laying out the city per step (houses would
  jump between steps).
- Official marks are extruded in the browser (no Blender needed by others).
- Internal folder and marker names stay `agent-town` so existing caches, settings, hooks keep working.

## How we'll know

- A1 split-at-every-line equality tests; a measured reload on the real record after appending to the
  huge session (target: under 2 s for the parse part).
- A2 frame cost of applying a newer world on the real record (target < 50 ms).
- A3 agents move continuously with a live session; time bar scrub leaves and "实时" returns.
- B1/B2/B3 unit tests on synthetic requests; a look at real steps.
- C2 the repo has no logo files; download → official marks locally; exports neutral.
- C3 run from a fresh clone in a temp folder (no node_modules, no build) → page opens.
- C4 first visit shows the tour; empty log roots → demo with the banner.
