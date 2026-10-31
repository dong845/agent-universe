# World v3 Step 3 — The 2.5D World in the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1/v2 3D renderer with the v3 world:
- an archipelago of themed islands, one per town, built from `payload.towns` and `payload.requests`;
- buildings drawn as Codex sprites from `art/manifest.json`;
- a fixed isometric camera that pans and zooms;
- hover cards with each request's details, click to open the request's diary, and the timeline growing the world.

**Architecture:**
- New pure modules in `packages/web/src/v3/`:
  - `townLayout.ts`: one town's cells, sprites and labels.
  - `archipelago.ts`: where every island goes.
  - `art.ts`: manifest lookup with fallbacks.
- New React Three Fiber scene in `v3/World25.tsx`:
  - every sprite of one art id is drawn with one shared mesh, one copy per position (instancing);
  - all sprites face the camera with one shared rotation, since the camera never turns.
- The store gets the v3 data and request selection. The old world components are deleted.
- `orchestrator/timeline.ts` stays for step 4 (figures).
- Ported from the throwaway demo (`scratchpad/at/demo/main.js`, owner-approved look):
  - the wedge streets;
  - at most 20 main houses and 6 tents per town;
  - the open square;
  - the hover card fields.

**Tech Stack:** React 19, R3F 9.8, drei 10.7 (`MapControls`), three 0.186, zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-world-v3-design.md` (sections 5, 8, 13.6). Owner decisions after the demo (2026-10-29):
- only the main work is drawn: the larger half, at most 20 houses and 6 tents per town;
- the hover card shows the details;
- uninformative titles continue the previous request's title (already in data);
- figures follow real events (step 4, not here).

## Global Constraints

- Every visible thing maps to data (D11.3). Missing art means a stated fallback (spec 13.6), never an invented building.
- The camera's azimuth is 45° (from the south-east) and its elevation 30°. It pans and zooms but never rotates.
- Performance: M4 production build, real data, world view and town view ≥ 55 fps, p95 ≤ 20 ms (spec 8).
- Privacy: real titles and paths appear only on the local page. Tests use demo or synthetic data; screenshots go to the Desktop only.
- `node --run test`, `node --run test:art` and `node --run e2e` are green at the end of every task that touches them.
- Commit locally per task; never push; stage named paths.

## Review Focus

1. A town with no produced work (only chat, or only investigations) still draws an island: hall, notice board, tents. No empty-wedge crash.
2. A town with more requests than its cells (hundreds) is capped at 20 houses and 6 tents, and the counts appear on the street signs and the banner.
3. A theme or faction with no art (film, codex, or every non-interim id) falls back along the stated chain, and the fallback is visible in the hover card ("示意图"). Nothing renders blank.
4. A request whose `topDir` is null or "." gets a street ("其他" or "根目录"), and towns with more than 6 folders fold the rest into "其他".
5. Scrubbing the timeline back hides houses whose request had not ended yet, and the landmark tier follows the produced count at that time.

---

### Task 1: Town layout (pure)

**Files:** Create `packages/web/src/v3/townLayout.ts`. Test: `tests/v3-layout.test.ts`.

**Interfaces:**
```ts
export interface Spot { art: ArtQuery; x: number; z: number; size: number; info: SpotInfo; from?: number /* ts it appears */ }
export type SpotInfo =
  | { kind: "house" | "tent"; requestId: string }
  | { kind: "public"; work: string; count: number }
  | { kind: "landmark"; tier: 1 | 2 | 3 } | { kind: "hall" } | { kind: "notice"; chats: number } | { kind: "prop" };
export interface TownLayout { cells: { q: number; r: number; kind: "grass" | "plaza" | "street" | "lot" }[]; spots: Spot[]; streets: { name: string; x: number; z: number; drawn: number; minor: number }[]; radius: number }
export function layoutTown(town: TownRow, requests: RequestRow[], cfg: { maxHouses: number; maxTents: number; minWork: number; tiers: [number, number, number]; maxStreets: number }): TownLayout
```
- Coordinates are town-local (hex size as in the demo: neighbours 2 apart).
- `ArtQuery` comes from Task 3.
- Rules, ported from the demo:
  - ring 0: the landmark;
  - ring 1: the hall, the notice board, and paving;
  - ring 2: paving;
  - ring 3: public buildings, spread evenly, only for work counts ≥ `minWork` (5);
  - from ring 4 out: one wedge per street, filled ring by ring;
  - houses: the larger half of produced requests by tokens, at most `maxHouses`; the rest count as `minor` on their street;
  - tents: the `maxTents` investigations with the most calls, on the outer ring;
  - trees on outer grass, by hash.
- `from` = the request's `endTs` (houses, tents), or the time the produced count reached the tier (landmark).
- [ ] Failing tests:
  - counts for a 50-produced / 21-investigation town: 20 houses, 6 tents;
  - no two spots share a cell;
  - every house is in its street's wedge;
  - a chat-only town has a hall and a notice board but no landmark;
  - the landmark tier follows produced counts 1 / 10 / 40;
  - the same input gives the same output;
  - a null `topDir` goes to "其他", and a 7th folder folds into "其他";
  - a town with 300 produced requests still has 20 houses and its minor counts add up.
- [ ] RED → implement → GREEN.
- [ ] Commit: `feat(v3): town layout — square, public ring, folder wedges, main work only`.

### Task 2: Archipelago (pure)

**Files:** Create `packages/web/src/v3/archipelago.ts`. Test: `tests/v3-archipelago.test.ts`.

**Interfaces:** `placeIslands(towns: { key: string; faction: Faction; kind: TownKind; radius: number; weight: number }[]): Map<string, { x: number; z: number }>`.
- Claude goes west (x < 0) and Codex east, with a 24-unit strait.
- Each side: the capital closest to the strait, then guilds, then projects by weight, then the outpost farthest out.
- Islands are placed on a spiral around the capital at the first spot that is clear of every placed island by ≥ 6 units.
- [ ] Failing tests:
  - no two islands overlap (distance ≥ r1 + r2 + 6);
  - every Claude island has x < −12 and every Codex island x > 12;
  - the capital is the one nearest the strait;
  - the result is deterministic;
  - 0 towns gives an empty map; 1 town works.
- [ ] RED → GREEN.
- [ ] Commit: `feat(v3): archipelago — factions either side of a strait, capitals at the centre`.

### Task 3: Art lookup with fallbacks (pure)

**Files:** Create `packages/web/src/v3/art.ts`. Test: `tests/v3-art.test.ts`.

**Interfaces:**
- `ArtQuery = { category, theme?, kind?, variant?, tier?, idea?, work?, faction?, name? }`.
- `resolveArt(manifest, q): { id: string; url: string; anchor: [number, number]; footprint: number; aspect: number; fallback: boolean } | null`.
- `assignIdeas(towns): Map<key, number>`: distinct landmark ideas 1–6 per theme, by stable key order, wrapping after 6.
- Fallback chain:
  - for a theme: theme → `craftsmen` → `publishing`;
  - for a house variant: b → a, then any other kind's house in the same theme;
  - for a landmark: the asked tier, then the nearest tier, then any idea of the theme, then the next theme in the chain;
  - for a public building: its faction → the other faction → none, in which case the hall draws in its place, marked `fallback`;
  - for misc and props: exact, else null (that spot is skipped).
- [ ] Failing tests: run against a fake manifest containing only the interim ids. For example:
  - film/house_video_b → publishing/house_video_a with `fallback: true`;
  - public_test_codex → hall_claude-code with `fallback: true`;
  - a missing prop → null;
  - every query in the demo layout resolves to non-null.
- [ ] RED → GREEN.
- [ ] Commit: `feat(v3): art lookup with stated fallbacks`.

### Task 4: The scene

**Files:**
- Create `packages/web/src/v3/World25.tsx` (islands, water, sprites, contact shadows), `packages/web/src/v3/Labels25.tsx`, `packages/web/src/v3/camera.ts`.
- Modify `packages/web/src/App.tsx` and `packages/web/src/store.ts`: add `towns`, `requests`, `layouts`, `centers` and `manifest`, loaded from `/art/manifest.json`.
- Delete: `world/Buildings.tsx`, `Cubes.tsx`, `Dressing.tsx`, `Terrain.tsx`, `Site.tsx`, `Town.tsx`, `World.tsx`, `FX.tsx`, `Figures.tsx`, `districtContext.tsx`, `Mat.tsx`, `palette.ts`, `looks.ts` and their imports. `Stage.tsx` and `Camera.tsx` are replaced by `v3/camera.ts`.

**Interfaces:**
- **Camera.** It looks along `VIEW = (cos30·sin45, sin30, cos30·cos45)`. `MapControls` has rotation off and zoom limited to 0.25–6. `flyTo(x, z, zoom)` is tweened and exposes `__agentTownFlying` for tests.
- **Sprites.**
  - One instanced mesh per art id.
  - The quad's width is `size·√2 / footprint`, in world units.
  - It sits at the anchor, offset toward the camera by `size/√2·cos30 + 0.05`, so the ground never cuts its base (as in the demo).
  - Only spots whose `from ≤ t0 + t` are drawn: the per-instance visibility is updated when the clock crosses a `from`, not every frame.
  - Material: `toneMapped: false`, alpha test 0.04.
- **Islands.** One instanced hex column plus one instanced cap per cell (the colours from the demo), a water plane, and a foam ring.
- **Labels.**
  - Far: town banners showing name, theme name, subtitle (the guild note) and counts. Banners declutter by produced count, and the HUD area is excluded.
  - Near (zoom ≥ 1.2): public building names with counts, and street signs ("<name> 街 · N 栋 · 另有 M 件小改动").
- [ ] Failing tests (Vitest, no WebGL):
  - `store.load(demoPayload())` builds a layout for every town and a centre for every layout;
  - the instance count of each art id equals the spots resolving to it;
  - setting the time before a request's `endTs` excludes its spot.
- [ ] Implement.
- [ ] `node --run build`: green. Look at the demo world and the real world myself (screenshots in the scratchpad).
- [ ] Commit: `feat(v3): 2.5D archipelago replaces the 3D world`.

### Task 5: Hover, select, diary, timeline, live

**Files:** Modify `packages/web/src/selection.ts`, `store.ts`, `ui/HoverCard.tsx`, `ui/Diary.tsx`, `ui/diaryModel.ts`, `data.ts`; create `v3/pick.ts`.

**Interfaces:**
- **Selection.** It becomes `{ kind: "request"; town: string; requestId: string } | { kind: "town"; town: string }`, with hashes `#req=<town>~<id>` and `#town=<key>`. An old `#task=<district>~<taskId>` maps to the request whose `taskIds` include it.
- **Picking.** `pickAt(x, y)` raycasts the sprite instances and checks alpha in the picked texture at the hit UV (as in the demo).
- **Hover card.** The demo's fields:
  - title, plus the user's own words (`asked`) when the title was continued;
  - product kind and street;
  - outcome, start time and duration;
  - the 4 token parts;
  - calls, failures, subagents and turns;
  - skills;
  - "示意图" when the art fell back.
  - Public buildings, tents, the landmark, the hall and the notice board each have their own lines.
- **Click.** The camera flies to the house (zoom 3.2), and the diary opens for the request. `fetchRequest(id)` uses `/api/request/:id`; on demo data it filters events by `taskIds`.
  - `diaryOf` gets the request's events and lists the turns as sections.
  - Esc and the back button work as before.
- **Live.** A request in `liveTaskIds` (any of its turns) draws its house at 55 % opacity with a pulsing ring. The scaffold art is missing, so this ruling is recorded in D17.
- [ ] Failing tests:
  - hash round-trip for request and town, and the old `#task` hash mapping;
  - `diaryOf` over a two-turn request shows both turns in order;
  - pick returns null on a transparent pixel of a sprite.
- [ ] Implement, then GREEN.
- [ ] Commit: `feat(v3): hover cards, request diary, selection by URL, live requests`.

### Task 6: Browser tests

**Files:** Rewrite `packages/web/e2e/world.spec.ts`, which currently tests the old world, for v3 on demo data.

- [ ] Tests:
  1. The page loads without console errors, and the canvas draws non-sky pixels.
  2. Every demo town has a visible banner or one hidden by a bigger town's banner it would cover, and no two visible banners overlap.
  3. Hovering a house (found through a test hook that projects a spot's centre) shows a card with a title and "token".
  4. Clicking it opens the diary with ≥ 1 step; Esc closes the diary and restores the camera.
  5. Reloading with `#req=…` restores the selection.
  6. Moving the timeline to its start hides every house; moving it to the end shows them.
  7. At zoom 2 the street signs are visible and none overlaps a building label.
- [ ] `node --run e2e`: green.
- [ ] Commit: `test(e2e): the v3 world on demo data`.

### Task 7: Real data, performance, record

- [ ] Run a production build and `node --run start`. Take screenshots of:
  - the world (whole archipelago);
  - the capital;
  - slides_maker (publishing);
  - a film town (fallback art);
  - the outpost;
  - a hover card;
  - an open diary.
  Save them to `~/Desktop/agent-town-v3/第3步/`.
- [ ] Measure the frame rate with `packages/web/e2e/fps.mjs`, adapted to the new view, in both views. It must be ≥ 55 fps with p95 ≤ 20 ms; if not, profile and fix before claiming done.
- [ ] Write D17: the layout numbers, fallbacks, the live ruling and the measured fps. Commit.
