# World v3 Step 2 — Art Pipeline and First Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command turns a generic art catalogue into checked, cut-out, packed building sprites drawn by Codex. The first batch is the publishing, film and craftsmen themes, plus the shared public buildings, misc pieces and props. The owner reviews it as a contact sheet on the Desktop.

**Architecture:** The art tools are Python under `scripts/art/`: numpy, scipy and Pillow are already installed, and the cut-out needs them. `art/catalog.json` is the generic catalogue: themes, items and a short description per item. `scripts/art/prompts.py` wraps each description in the fixed style, view and background text, and asserts that no local town name leaks into a prompt. `generate.py` drives `codex exec` (subscription, no API key). `cutout.py` and `qa.py` key out the magenta background and check each image. `pack.py` writes two WebP sizes and `art/manifest.json`, which records each image's footprint anchor. `run.py` orchestrates: missing → generate → cut → check (reroll up to 2 times) → pack → contact sheet.

**Tech Stack:** Python 3.13, numpy, scipy, Pillow (WebP), pytest 9; Codex CLI 0.154.

**Spec:** `docs/superpowers/specs/2026-10-29-world-v3-design.md` (sections 7, 13.1–13.3, 13.7).

## Global Constraints

- Prompts contain only theme and building descriptions. Never project names, paths or conversation text. `prompts.py` refuses to build a prompt that contains a forbidden name; at run time the forbidden names are the town names from `/api/world`, when the local server is up.
- Generation uses the Codex subscription only. Before a batch, one preflight image must succeed. If it fails, stop and print why; never fall back to a paid API.
- Each image: automatic QA, at most 2 rerolls. Images that still fail go to the contact sheet's "待你看" (for you to check) row and do not enter the manifest.
- Commit to git: the 512 px and 128 px WebP files, `art/manifest.json` and `art/catalog.json`. Raw images go to `~/.agent-town/art-src/` and never into git.
- Contact sheets go to `~/Desktop/agent-town-美术/<batch>.png`.
- The fixed view is strict 2:1 isometric from the south-east, 30° elevation, on a magenta `#FF00FF` background, with no text.
- Tests: `python3 -m pytest -q tests/art` (synthetic images only); `node --run test` stays green.
- Commit locally after each task; never push; stage named paths only.

## Review Focus

1. A building with magenta-ish details (a red roof in pink light, purple flowers) must keep them. Only magenta connected to the border is removed.
2. A generated image whose background is not uniform (a gradient, a ground plane drawn in) must fail QA ("edge not clear"), not ship with a halo.
3. A view that drifted (front-on or top-down) must fail the footprint-slope check.
4. A Codex run that returns no file (plan without image tool, timeout) gets a reroll, and after the limit it is reported. The batch never hangs and never silently skips an image.
5. A town name that happens to be an English word ("music") must not block a generic prompt. Only names of 4+ characters that are not catalogue keywords count as forbidden.

---

### Task 1: Catalogue and prompts

**Files:**
- Create: `art/catalog.json`, `scripts/art/prompts.py`
- Test: `tests/art/test_prompts.py`

**Interfaces:**
- `art/catalog.json`:
  ```json
  { "style": "...", "view": "...", "background": "...",
    "factions": { "claude-code": "terracotta red roof tiles and banners", "codex": "slate blue roof tiles and banners" },
    "themes": { "<id>": { "name": "出版镇", "town": "<one sentence: materials, palette, mood>",
                 "landmarks": [ { "idea": "<landmark description>" } ×6 ],
                 "houses": { "code": ["<variant A>", "<variant B>"], "docs": [..], "slides": [..], "image": [..], "video": [..], "data": [..] } } },
    "shared": { "public": { "read": "...", "edit": "...", "run": "...", "test": "...", "online": "...", "external": "...", "plan": "...", "image": "...", "screen": "...", "spawn": "...", "compact": "...", "hall": "..." },
                "misc": { "tent_a": "...", "tent_b": "...", "notice": "...", "scaffold_1": "...", "scaffold_2": "...", "scaffold_3": "...", "capital_claude-code": "...", "capital_codex": "...", "outpost": "..." },
                "props": { "tree_round": "...", "tree_cypress": "...", "tree_pine": "...", "bush": "...", "rocks": "...", "lamp_crates": "...", "flowerbed": "...", "well": "..." } } }
  ```
  - Batch-1 themes: `publishing`, `film`, `craftsmen`.
  - The house descriptions carry the door-sign prop from spec 13.3: gear, scroll, easel, picture frame, film reel, crates.
  - The landmark tiers come from one idea: tier 1 is a "small early version", tier 2 is "the full building", tier 3 is "the grand expanded version with annexes".
- `prompts.py`:
  - `Item = {id, theme, category, prompt}`, where id is e.g. `publishing/landmark_2_t3`, `publishing/house_code_b`, `shared/public_read_codex`, `shared/misc_tent_a`, `shared/prop_tree_round`.
  - `items(catalog, themes: list[str], shared: bool) -> list[Item]`.
  - `build_prompt(desc, town_line, faction_line, cat) -> str`.
  - `check_private(prompt, forbidden: list[str]) -> None` raises `PrivacyError` when a forbidden name (case-insensitive, length ≥ 4, not a word in the catalogue) appears.
- [ ] **Step 1: Failing tests:**
  - Batch-1 item count: per theme 6 × 3 landmarks + 6 × 2 houses = 30, so 3 themes give 90. Shared: 12 × 2 public + 9 misc + 8 props = 41. Total 131.
  - Every id is unique.
  - Every prompt contains the fixed view and background text and the word "magenta".
  - No prompt contains "text" except inside the "no text" clause.
  - `check_private` raises on `"slides_maker"` in the forbidden list, but not on `"music"` (a catalogue word) or on 3-letter names.
  - Unknown theme → `KeyError` with the theme's name.
- [ ] **Step 2:** `python3 -m pytest -q tests/art/test_prompts.py`. Expected: FAIL (module missing).
- [ ] **Step 3:** Write the catalogue with concrete, distinct descriptions per theme, and implement `prompts.py`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat(art): generic catalogue and prompts that never carry a local name`.

### Task 2: Cut-out and QA

**Files:**
- Create: `scripts/art/cutout.py`, `scripts/art/qa.py`
- Test: `tests/art/test_cutout_qa.py` (synthetic images drawn with Pillow)

**Interfaces:**
- `cutout(img: Image) -> Image`:
  - Returns RGBA, trimmed to content plus 4 px.
  - Only background connected to the border is removed: within `hard`=90 of magenta, or with the magenta chroma `min(r,b)-g > 120`. The edge is softened between 90 and 170, and spill is removed.
  - Raises `CutoutError("no background")` when nothing is connected to the border.
- `qa(rgba: Image, category: str) -> list[str]` returns the names of the problems found:
  - `"edge not clear"`: the 1-px border has alpha > 0.05.
  - `"kept ratio"`: the opaque share is outside 0.15–0.95, measured on the trimmed image.
  - `"magenta fringe"`: magenta-hued opaque pixels > 0.5%.
  - `"aspect"`: w/h is outside 0.45–2.2.
  - `"view"`: buildings only (categories landmark, house, public, misc).
    - In the bottom band, for heights h from 3% to 20% of the width above the lowest opaque row, the opaque half-width should grow at about 2 per unit of h.
    - Fit the slope by least squares; it must be within 2 ± 0.3.
    - Skipped for props.
- [ ] **Step 1: Failing tests:**
  - A diamond footprint plus a box on magenta → cut out, QA empty.
  - An interior magenta window on the building is kept (alpha 255 there).
  - A vertical gradient background → `"edge not clear"`.
  - A front-on rectangle footprint → `"view"`.
  - An all-magenta image → `CutoutError`.
  - A thin magenta outline around the building → `"magenta fringe"`.
  - A prop with no diamond → no `"view"` check.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement, starting from the demo's cutout (keep the border-connected rule). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(art): magenta cut-out and automatic checks`.

### Task 3: Pack and manifest

**Files:**
- Create: `scripts/art/pack.py`
- Test: `tests/art/test_pack.py`

**Interfaces:**
- `pack(rgba, item, out_dir) -> dict`:
  - Writes `<out>/<theme>/<name>.webp` (longest side 512, quality 88, alpha) and `<out>/<theme>/<name>@128.webp`.
  - Returns the manifest entry `{ id, w, h, anchor: [ax, ay], footprint: fw, category, theme, promptHash }`.
  - The anchor and footprint are fractions of w and h, so both sizes share them.
  - The footprint is the widest opaque row in the bottom 40%; the anchor is its centre, raised by a quarter of its width (the middle of the 2:1 diamond).
- `write_manifest(entries, path)` writes sorted keys, stable for git diffs.
- [ ] **Step 1: Failing tests:**
  - The synthetic diamond's anchor is within 2% of the known diamond centre.
  - Both files exist; the 128 px file is ≤ 128 on its longest side.
  - The manifest round-trips, and writing it twice gives identical bytes.
  - An image with no opaque pixel in the bottom 40% raises.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** `feat(art): two-size WebP sprites and a manifest with footprint anchors`.

### Task 4: Codex driver and orchestrator

**Files:**
- Create: `scripts/art/generate.py`, `scripts/art/run.py`, `scripts/art/sheet.py`
- Modify: `package.json` (add `"art": "python3 scripts/art/run.py"`, `"test:art": "python3 -m pytest -q tests/art"`)
- Test: `tests/art/test_run.py`. A fake `codex` executable on PATH writes a magenta-background PNG of a diamond house to the asked file, or nothing, or a bad image, depending on an environment variable.

**Interfaces:**
- `generate(item, raw_dir, codex="codex", timeout=600) -> Path | None`:
  - Runs `codex exec --skip-git-repo-check -C <tmp workdir> <instruction>`.
  - The instruction is the slide-maker script's wording: use the hosted image tool, the prompt passed verbatim, and write the image to `./<file>`.
  - Then it checks that the PNG exists and decodes. As a fallback, it takes the last `image_generation_call` from the rollout file this run created (newest under `~/.codex/sessions` after the start time).
  - Returns None on failure, with the reason logged.
- `run(themes, shared, raw_dir, out_dir, sheet_path, forbidden, concurrency=3, rerolls=2) -> Report`:
  - Preflight with the first missing item; if it fails, raise `NoImageTool` with the logged reason.
  - Then a thread pool. Each item goes through generate, cutout, QA and pack; an item that fails cut-out or QA is regenerated, up to `rerolls` times.
  - Items already in the manifest with the same promptHash are skipped.
  - Writes the manifest and the contact sheet, with a "待你看" row for failures.
  - `Report = {made, skipped, failed: [(id, reasons)]}`.
- CLI: `node --run art -- --themes publishing,film,craftsmen --shared`, with an optional `--only <id-glob>` and `--redo <id-glob>`.
- [ ] **Step 1: Failing tests (fake codex):**
  - Two items both succeed: the manifest has 2 entries and the sheet exists.
  - A fake that writes nothing → after 1 + 2 tries the item is in `failed`, the run completes, and the manifest excludes it.
  - A preflight failure → `NoImageTool` raised and nothing else attempted.
  - A second run makes 0 (skipped).
  - `--redo` regenerates the one item.
  - A forbidden name in a prompt → `PrivacyError` before any codex call.
- [ ] **Step 2–4:** RED → implement → GREEN. Also run `node --run test` (unchanged, green).
- [ ] **Step 5: Commit** `feat(art): Codex driver, rerolls, contact sheet; node --run art`.

### Task 5: First batch for real

**Files:**
- Create: `packages/web/public/art/**` (generated), `art/manifest.json`
- Modify: `docs/decisions.md` (D16)

- [ ] **Step 1:** With the local server up (for the forbidden names), run `node --run art -- --themes publishing,film,craftsmen --shared`. Expected: preflight OK, then about 131 items, the report printed.
- [ ] **Step 2:** Look at the contact sheet myself. Reroll by `--redo` any image that is off-theme, off-view or tinted. That includes known risks: smoke picking up magenta, and two variants looking alike.
- [ ] **Step 3:** Copy the sheet to `~/Desktop/agent-town-美术/批次1.png` and report the counts: made, rerolled, failed.
- [ ] **Step 4:** Write D16: the pipeline, QA thresholds, the batch counts, the sizes in the repo (MB) and what the owner saw.
- [ ] **Step 5: Commit** the WebP files, the manifest and D16: `feat(art): first batch — publishing, film, craftsmen, shared buildings`.
