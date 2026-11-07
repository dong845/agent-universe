# Clear names, real scale, a page that steps aside, safer answers — design (2026-11-07, D27)

The owner asked what still needs work for a person using Agent Universe. A look at the real page
(headless, 1440×900, 2026-11-07; screenshots in the scratchpad only) found the list below; the owner
picked all four groups, then **suburbs of tiny houses**, **rename + hide + merge**, and **万 / 亿** units.

## Facts checked (2026-11-07)

- "都城 / capital" is the town of sessions working in tool folders (`~/.claude`, `~/.codex`, …),
  "野外营地 / field camp" the town of sessions in temp folders (`server/src/assign.ts` `place`). Neither
  is explained anywhere. Each side has one, so space shows two "field camp" planets.
- The city bar shows the town name and then its theme name: "capital capital · Codex".
- `formatCount` (`schema/src/aggregate.ts`) stops at M: the HUD shows "36811.7M" in both languages.
- 需要你, with no ask hook, offers only "复制恢复命令" for a session that is alive and waiting in its
  terminal; resuming it would open a second copy. The project name is cut to "field ca…" because the
  button takes half the row.
- In a city the Overview panel (372 px) covers the right quarter; the scene stays centred under it, so
  labels sit under the panel. 需要你 floats over the city's middle-top.
- Overview lists the kinds of work twice (chips under "What the city has built", bars under "Work done
  most"). Root files make a street called "other St".
- A city draws at most 20 houses (`LAYOUT_DEFAULTS.maxHouses`): a project with 138 finished pieces looks
  like one with 20. Overview says "20 drawn of 138".
- Space labels can leave the screen ("ield camp" at the left edge). "← Back to space" wraps.
- Leftovers of the D26 review: a multi-select answer with "Other" text sends only the text; an
  `AskUserQuestion` whose input does not parse is held as an approval (Claude Code then ignores Allow);
  the settings hint does not say Allow approves a command on this machine.
- The diary works on one request (one session), so its literal `"main"` never merges two sessions:
  no change. The store's old per-district runtimes build timelines from raw ids; they get `uniqueAgents`
  (idempotent) so they can never merge two sessions.

## A. Names

- **A1 Explain the two odd planets.** Under the name of a capital / field camp (city bar, Overview, hover
  card) one line says what it holds: "在 ~/.claude、~/.codex 等工具目录里做的事" / "在临时目录里做的事"
  (English likewise). The city bar no longer repeats the theme name when it equals the town name.
- **A2 Rename.** Overview's header has ✎: type a name, Enter saves, empty restores the folder name. The
  name shows everywhere the town name shows (space, city, search, 需要你, mini window, exports — exports
  keep following the existing project-names switch).
- **A3 Hide.** Overview has "从太空隐藏 / Hide from space". A hidden town draws no planet; its work still
  counts in the shells and totals and in the "N small projects not shown" line (which says how many
  the owner hid). Settings lists hidden towns, each with "显示 / Show". Search still finds a hidden town
  (marked hidden) and can open its city.
- **A4 Merge.** Overview has "并入… / Merge into…": a list of the other towns of the same side (not
  capital / field camp, not itself, not a town already merged away). Merging moves every request of
  this town into the other one, as if its folder belonged there; "取消合并" (in Settings, beside hidden
  towns) moves them back. A merge takes effect on the next recompute (seconds); the page shows a toast.
- **A5 Storage.** `~/.agent-town/towns.json` `{ names: {key: name}, hidden: [key], merge: {key: key} }`
  — missing or damaged file = nothing set; a key that no longer exists is ignored; a merge chain or
  cycle resolves to its end or is dropped (never loops). Written by `POST /api/towns` (same origin
  rules as the other routes). Names and hidden apply when towns are built (`buildTowns`); merges apply
  where requests get their project (`assignProjects`), so requests, events, layouts and history agree.

## B. Numbers and layout

- **B1 Units.** `formatCount(n, units)`: English k / M / B (36.8B); Chinese 万 / 亿 below 1e4 raw,
  then `x.x万`, then `x.x亿` (368.1亿). Every page number that used `formatCount` follows the page
  language; exports follow the language chosen when exporting.
- **B2 The city steps aside.** While a right panel (Overview, History) is open, the city's picture
  shifts left by half the panel's width (camera view offset, eased), so the middle of the city is the
  middle of what is still visible; labels and clicks follow the same projection.
- **B3 需要你 rows.** The name gets the full row; the action sits under it. 需要你 in a city sits under
  the top bar on the left of the panel, never over the centre (it already moves beside the panel).
- **B4 The right action.** For a live session waiting for approval or input:
  - with a held decision → "选择 / Decide" (as now);
  - without the hook → "在终端里回答" note + "在页面上回答…" which turns on the ask hook for that side
    (same as the settings switch) and says it applies from the next question;
  - turn finished or error → "复制恢复命令" stays (the terminal may be gone).
- **B5 Small fixes.** Overview drops the duplicate chips (keeps the bars) and shows "圆塔 N 座" in
  "What the city has built". Root files' street is "其他文件 / Other files" (no "街 / St" suffix).
  Space labels stay inside the screen (clamped with a 12 px margin). City bar buttons do not wrap.

## C. Real scale: suburbs

- **C1** Every finished piece of work the city does not draw as a house becomes a tiny house on the
  outskirts: seven to a hex (centre + six around), on the rings beyond the houses and tents, in the
  order the work finished. Roof colour = kind of product (as the houses' light colour). At most 600
  tiny houses; more are counted. The island grows to hold them.
- **C2** They appear at the moment their work finished, so history steps and replays grow the suburbs
  too. Hover shows the request title (as a house does); click opens it.
- **C3** Drawn as two instanced meshes (walls, roofs): one draw call each whatever the count.
- **C4** Overview: "大房子 20 · 郊区小房子 118" instead of "20 drawn of 138".

## D. Safer answers

- **D1** Multi-select + "Other" sends the picked labels and the text ("A, B, my text").
- **D2** An `AskUserQuestion` whose questions do not parse is not held: the terminal asks as usual.
- **D3** The settings hint adds: "允许 = 在这台电脑上批准执行该操作" / "Allow approves the action on this
  computer".

## Non-goals

Merging across sides (Claude ↔ Codex); renaming the capital's or field camp's folder rules; moving
single requests between towns; sharing names to other machines (they live in `~/.agent-town`).

## Calls I made

- Rename / hide / merge live in the Overview panel (one place per town); undo lives in Settings.
- Hidden towns still count everywhere except as planets; search still reaches them.
- Merge is applied at project assignment, not on the page, so every view agrees after one recompute.
- Suburbs cap at 600 per city; tiny houses are clickable like houses.
- 需要你 keeps "copy resume" only for finished or failed turns.

## How we'll know

- A: unit tests for towns.json reading (damaged, unknown keys, chains, cycles), names/hidden in
  `buildTowns`, merge in `assignProjects`, the HTTP route (bad bodies → 400); e2e: rename in Overview →
  the planet's label changes; hide → planet gone, Settings shows it, Show brings it back.
- B: unit tests for both unit systems (edges 9999, 1e4, 1e8, 1e9); e2e: with Overview open the city's
  centre projects left of the screen centre; 需要你 row name not truncated for "field camp"; a look.
- C: unit test that a 138-finished town gets 118 tiny houses (≤ 600, ordered by finish time, none on a
  taken cell); a look at the real city.
- D: unit tests (answerOf multi + other; unparsable AskUserQuestion not held).
- Whole suite + e2e green; real-data screenshots (scratchpad only) looked at before calling it done.
