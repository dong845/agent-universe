# Names, scale, layout, safer answers — Implementation Plan (D27)

> Executed inline (superpowers:executing-plans). Spec: `docs/superpowers/specs/2026-11-07-names-scale-polish-design.md`.

**Goal:** the four groups of the spec — clear names (explain / rename / hide / merge), number units and a
city that steps aside for its panels, suburbs that show a city's real size, safer page answers.

**Global constraints:** Node 22 type-stripping on the server (no parameter properties); every new string
through the zh/en dictionary; no real logs, paths or names in tests or fixtures; stage named paths only.

## Review Focus

- towns.json damaged / hand-edited (wrong types, unknown keys, a merge cycle, a merge into a hidden town).
- A merge target that later disappears (its folder gone) — requests must not vanish.
- Renamed town in share mode / exports (names follow the existing switch, never leak when off).
- Suburbs in a history step or replay (only those finished by then), and a town with 0 or > 600 extras.
- View offset with the window resized, and clicks / labels / follow while offset.

### Task 1: Units — `formatCount(n, units: "en" | "zh" = "en")` in `schema/src/aggregate.ts`; page helper `count(n)` in `web/src/i18n/index.ts` (page language); poster passes its language. Tests: `aggregate` edges 999/1000/999_999/1e6/1e9 (en), 9999/1e4/1e8 (zh).

### Task 2: Safer answers — `answerOf` joins labels and other; server `hold` returns null for an AskUserQuestion with no parsable questions; settings hint text. Tests: decision.test (multi + other), ask.test (unparsable not held).

### Task 3: Town settings on the server — `server/src/townPrefs.ts` `readTownPrefs(file)`, `writeTownPrefs`, `resolveMerge(prefs, keys)`; `TownOptions.names/hidden`; `TownRow.hidden?`, `TownRow.folderName`; `assignProjects(..., merge)` remaps `faction|projectId`; `POST /api/towns {key, name?|hidden?|merge?}` then recompute; `GET /api/towns` prefs. Tests: townPrefs (damaged, wrong types, chains, cycles), towns (names/hidden), assign (merge), http (route, 400s).

### Task 4: Names on the page — city bar (no repeated theme; explanation line for capital/outpost), Overview ✎ rename / hide / merge, Settings hidden + merged list with undo, galaxy skips hidden (count in "not shown" line), search marks hidden. Tests: unit for the "not shown" count; e2e rename + hide/show.

### Task 5: Layout — 需要你 row layout + B4 actions; Overview drops duplicate chips, adds round-tower count; street "Other files"; space label clamp; city bar nowrap; city view offset while a right panel is open. Tests: needs action unit (state → action), e2e offset (city centre projects left of screen centre with Overview open).

### Task 6: Suburbs — `layoutTown` adds `suburbs: {requestId, x, z, from, kind}[]` (7 per hex beyond houses/tents, ≤ 600, by end time, island grows); `Suburbs` instanced component (count by scene time), hover/click; Overview "big houses · suburbs". Tests: layout (138 → 118, cap, order, no taken cell, 0 extras), overview numbers.

### Task 7: Verify — full unit suite, e2e (serial), real-page look (zh + en), sonnet review of the branch, fixes, decisions.md D27.
