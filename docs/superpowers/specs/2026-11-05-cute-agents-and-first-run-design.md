# Cute agents, a first run that works, and new reasons to keep it open — design (2026-11-05)

The owner asked for agents and subagents that are as good-looking and cute as possible, and for an honest
look at whether a first-time user can use Agent Universe. A look at the page (empty logs, first visit;
real data, city view) and at similar projects (Pixel Agents, Claude Office, claudlet, Tamamon,
cc-wrapped, Strata, Vibecraft, Claude Theater) gave the list below. The owner picked, from rendered
concepts and option lists: **direction B "大头"**, **subagents carry a prop for their kind of work**,
**all four first-run fixes**, **all four new features**.

What the look found (each seen on screen, 2026-11-05):

- Today's robot is boxy and mechanical, and only ~12 px tall in the default city view: the most
  lovable part of the product goes unnoticed. Subagents differ only by size and chest-light colour.
- With no logs, the yellow notice covers the top bar and the Dyson-shell panel.
- The tour is a text card in a corner: it never points at anything or moves the camera; step 4 talks
  about the city while space is on screen; after it nothing suggests clicking a planet; in the demo
  world it still says "这里是你用 Claude Code 和 Codex 做过的事".
- In a city up to five panels are open at once (tour, legend, Dyson shell, 需要你, 历史) and cover it.
- "等效花费 · 未配置价格" is shown to everyone and never has a value (HUD, hover card, diary).
- The page is Chinese only; the README is English. No way to find a project by name.

## A. The agents (direction B "大头")

Reference: `2026-11-05-agent-concepts.jpg` beside this file, middle panel, made by the throwaway spike
`scripts/models/robot_concept.py` (its `chibi()`), which is the starting point for A1 and is deleted when A1
lands. For shape and proportions the picture wins; for colours the text below wins (the spike's colours
are washed out).

- **A1 Model.** A new Blender-scripted model replaces `scripts/models/robot.py`'s robot: a big soft
  rounded head (~55 % of the height) with a black glossy screen face, a small round body with a chest
  light, stubby round arms, two small dark feet, headphones and a short antenna with a glowing tip. Same
  pipeline as today (script → `packages/web/public/models/robot.glb`, named nodes the code animates:
  `Body`, `Head`, `ArmL`, `ArmR`, plus `FootL`, `FootR`). Materials stay named so the code recolours them.
- **A2 Colour code.** Eyes, mouth and antenna tip glow in the **faction** colour (Claude orange, Codex
  blue), so the side is readable on every agent. Headphones: faction colour on a main agent, the
  subagent's **role** colour (`WORK_COLOR`) on a subagent. Chest light: the colour of the work being done
  right now (the action's `outfit`). The main agent keeps its faction emblem floating above the head.
- **A3 Expressions.** The face screen shows a state, as separate face meshes in the GLB the code switches
  (one visible at a time), plus a blink every few seconds on the normal face:

  | state (from the timeline pose / end) | face |
  |---|---|
  | walk, carry, report, idle | normal round eyes + small smile, blinks |
  | work | focused: flattened eyes |
  | think, pack | eyes looking up-side + three dots over the head (today's dots) |
  | raise_hand (waiting for you) | wide eyes + "?" — hand raised as today |
  | shake, fall (error) | X X, red |
  | done (after the request end) | ^ ^ happy, little hop as today |
  | idle longer than 60 s of scene time while not done | sleepy — — |

- **A4 Subagent props.** A subagent is smaller (as today) and carries one prop for its kind of work,
  modelled in the same Blender script as separate named nodes and attached to the head or right hand:

  | role | prop | | role | prop |
  |---|---|---|---|---|
  | scout (read/search, Explore) | magnifying glass | | scribe (plans, todos) | clipboard |
  | smith (edits) | pencil | | painter (images) | beret + brush |
  | engineer (shell) | hard hat | | operator (computer use) | goggles |
  | inspector (tests) | round glasses | | diplomat (MCP tools) | bow tie |
  | messenger (web) | little satellite dish | | sentry (guardian) | shield |

  A subagent's role is its `baseRole`; a general subagent (`baseRole` commander — most of them) takes
  the role it has used most among its actions so far (ties: the earliest), so its prop can change as it
  works; before any action it carries a small backpack.
- **A5 Size.** Agents get bigger: in the default city camera on a 1440×900 page, a main agent stands
  **≥ 40 px** tall (measured by projecting its bounding box), a subagent ≥ 28 px, and they still fit
  between buildings without clipping into them at their work lanes. Labels stay readable.
- **A6 Everywhere the same character.** One shared description, `art/character.json` (face-screen size,
  eye/mouth shape per expression, colours), is read by both the Blender script and the 2D face, so the two
  cannot drift. A 2D face of the same character (SVG: head, screen, the current
  expression, faction/role colour, the prop as a small icon) is used in DOM places: the follow card, the
  mini window, 需要你 rows, the poster. One component, drawn from the same state table.

## B. First run that works

- **B1 Guided tour.** Each step moves the camera to what it explains and highlights it (a ring on the
  3D object, an outline on a DOM panel); the card sits next to the highlight:
  1 welcome (space) → 2 the two stars and the Dyson shell → 3 a planet (the biggest) → 4 into its city:
  buildings and towers → 5 a robot: click it to follow (the follow card opens for the step) → 6 需要你
  and 历史 → 7 back in space: "点任意行星进城" with the planets gently pulsing until the first click.
  Skippable at every step; done is remembered; "重新看导览" in settings replays it. The welcome text
  depends on the source: real logs / demo (demo: "这是一个演示世界……有了日志会自动换成你的").
  When the chosen city has no agent at that moment, step 5 uses the history step's standing agents.
- **B2 A tidier city.** On entering a city the legend starts collapsed (the user's own open/closed choice
  is remembered after that) and the Dyson-shell panel is hidden (it is about the stars). 需要你 keeps its
  place; with 历史 also open the two never overlap (existing beside-diary rule).
- **B3 Dead spots.** The no-logs notice moves out of the top bar into a card under it that can be closed
  (it never covers the HUD or another panel). The "等效花费" row is removed from the HUD, hover card and
  diary (no pricing exists; showing a stat that is never filled is worse than none). **Search:** a search
  box (and the `/` key) matches project names (and skill guilds) as you type; Enter or a click flies to
  the planet, a second Enter enters the city. Works in share mode on the names the share shows.

## C. New features

- **C1 Follow an agent.** Clicking a robot (in the live city or a history step) makes the camera follow
  it smoothly; a card shows its face, who it is (主代理 / 子代理 · type · its task line), what it is doing
  now (the event's tool and target — file name or command, as on this machine; in share mode only the
  kind of work; its task line follows the titles switch), for how long, its tokens so far, and the
  subagents it sent (click one to follow it instead). All of it is computed on the page from the town's
  events the city already holds (`model_call` tokens per `agentId`, `tool_start`/`tool_end` per action),
  live and in a history step — no schema or server change. Esc, the card's ×, or dragging the camera stops following. Its parent is one click away.
- **C2 Mini window.** A "小窗" button (shown only where the browser supports Document Picture-in-Picture,
  i.e. desktop Chrome/Edge) opens a small always-on-top window: one row per live session (face with its
  current expression, project, what it is doing, how long), 需要你 rows on top with the × and copy-resume
  actions, and a "回到页面" link that focuses the main tab. DOM only — no second 3D scene. It updates
  from the same store; closing it changes nothing else.
- **C3 Review poster.** "回顾海报" (in the share menu) for this week / this month / this year / all time:
  a portrait PNG (1080×1350) with a background shot of the universe, the period, a day heatmap, the
  longest streak of active days, requests, finished pieces of work, tokens, the busiest project, the
  most-used kinds of work and subagent types, and the character's face. Same privacy rules as other
  exports: project names follow the export switch (shown by default), request titles and gists never,
  no paths or session ids. Downloaded as `agent-universe-review-<period>-<date>.png`.
- **C4 Sounds and celebrations.** Optional sounds (off by default; a settings switch): a soft chime when a
  turn finishes, a two-note call when a session starts waiting for you — made with Web Audio, no files,
  quiet, at most one per 3 s. Celebrations for milestones reached **while the page is open** (never
  replayed for history on load): the 10th/50th/100th/250th/500th/1000th finished piece of work, each 10 %
  of a Dyson shell lit, a project's first finished piece: a burst of light at the star or planet and a
  toast; each shown once (remembered).

## D. English interface

- Every user-facing string goes through one dictionary (zh, en). The language follows the browser
  (`zh*` → Chinese, else English) and can be switched in settings (remembered).
- Texts the server builds for the page — the untitled-request sentence (`RequestRow.gist`) — become
  language-neutral facts (kind of work, counts, a few names) that the page formats in its language. The
  wire payload changes (fine: gist was never exported, and the disk cache holds events, not requests).
  macOS notifications use the language the page last chose, saved through the existing `/api/settings`;
  before any page has chosen, the server's `LANG`. Terminal messages of
  `npm start` and the server follow `LANG` (zh → Chinese, else English).
- Exports (share page, recordings, poster) use the language chosen when exporting.
- `README.md` stays English and links a new `README.zh.md`; both describe the same commands.

## Order

One plan, in phases that each ship working: A (agents) → D's dictionary in place → B → C → D's remaining
strings and the README. New strings from B and C are written through the dictionary from the start.

## Non-goals

A second 3D scene in the mini window; sounds as audio files; achievements beyond the milestones above;
cost pricing; languages beyond zh/en; changing the city layout or building models.

## Calls I made (owner can overrule)

- Faction colour lives in the eyes (every agent), role colour in a subagent's headphones; chest light =
  current work.
- General subagents take the prop of the work they have done most; it may change while they work.
- The poster is portrait 1080×1350 (fits phones and most social feeds).
- Sounds default off; celebrations default on but only for things that happen while the page is open.
- The cost stat is removed rather than kept as a placeholder.
- Tour step 5 uses history agents when the city has none live.
- The poster's project names follow the existing `townNames` export switch (default on); the face and
  the busiest-project line are not private beyond that switch.
- If 40 px agents clip into buildings at their work lanes, the lanes/door offsets move first, then the
  default city camera; the size floor stays.
- The mini window button is hidden where Document Picture-in-Picture is missing (no `window.open`
  fallback).

## How we'll know

- A: renders of the model (each expression, each prop) looked at; in the real city a screenshot shows
  agents ≥ 40 / 28 px; expression switches covered by a unit test of the state → face table; prop choice
  by a unit test (baseRole, most-used, tie, no actions).
- B: e2e: tour moves the camera (camera target changes per step), ends with planets pulsing; legend
  collapsed in a city; the empty-logs card does not overlap the HUD (bounding boxes); no "等效花费" in the
  DOM; search finds a project and enters its city.
- C: e2e: click a robot → following (camera target tracks it), card shows tool/target, share mode hides
  the target; mini window opens in headless Chrome if the API is there, else the button is hidden; poster
  PNG has the right size and contains no title/path/session id strings (checked on the drawn text list);
  sounds: rate limit unit-tested, off by default; milestones: shown once, not for history on load.
- D: no Chinese string left outside the dictionary (a test scans `packages/web/src`); English page
  screenshot looked at; gist facts format in both languages.
- Whole suite + e2e green; real-data screenshots (scratchpad only) looked at before calling it done.
