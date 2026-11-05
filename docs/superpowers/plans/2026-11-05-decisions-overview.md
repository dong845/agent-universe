# Answer from the page, project overview, owner fixes — Implementation Plan (D26)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** the fixes A1–A4, answering decisions from the page (B), the Overview tab (C).
**Spec:** `docs/superpowers/specs/2026-11-05-decisions-overview-design.md`
**Tech:** as D25 (React 19, R3F, zustand, Vitest, Playwright; server under Node type stripping).

## Global Constraints
- Server/schema/adapter code: no parameter properties, enums, namespaces (node-strip test).
- Real logs never in tests or fixtures; subagents never read ~/.claude/projects, ~/.codex, ~/.agent-town.
- Every page string through i18n (no-cjk test); unit tests run with LANG=zh_CN, e2e with locale zh-CN.
- Hooks: backup before writing, marker `agent-town-ask`, removable; never touch other tools' hooks.
- Answer route: same origin + token; never answer a hook without an explicit page action.

## Review Focus
1. Two pages open, or a page closed mid-wait → the hook is released (no 120 s stall in the terminal).
2. A hook for a session the page has never seen (new project, logs not read yet) → still shown and answerable.
3. Multi-question AskUserQuestion, multiSelect, and "其他" free text → answers keyed by question text, labels joined by ", ".
4. Server restarted while a hook waits → curl ends, terminal keeps asking; no crash.
5. Language: decision panel, overview, notification texts in zh and en.

### Task 1: One robot per agent (A1)
Files: `packages/web/src/orchestrator/sessionAgents.ts` (new) `uniqueAgents(events): AgentTownEvent[]` — Claude `agentId === "main"` → `main@<sessionId>`, `parentAgentId === "main"` likewise; used by LiveAgents, ReplayAgents (cityReplay start), stepAgents, FollowCard, miniRows, agentFacts callers. City: LiveAgents returns null while a replay of that city plays; bubble label names the request when > 1 main. Test: `tests/sessionAgents.test.ts` (two sessions → two commanders in buildTimeline; Codex ids untouched; idempotent).

### Task 2: Poster rows (A3)
`share/poster.ts`: measure the work labels, bars start after the widest + 24 px, label font shrinks to keep bars ≥ 40 % of the width. Test in `tests/review.test.ts`: a stub ctx recording fillText x/width and roundRect x → no label overlaps its bar, zh and en.

### Task 3: Mini window rows (A4)
`ui/MiniWindow.tsx`: a working row is a button → `window.focus()`, `setCity(townKey)`, then follow the main robot when it appears (`followMainWhenReady()` moved out of Tour.tsx into `city/followMain.ts`). e2e `mini.spec.ts` extended.

### Task 4: Deliveries (A2)
`city/deliveries.ts` `deliveriesAt(requests, now, windowMs = 9000): {requestId, from: "hall", to: Vec, k: number}[]` (requests of the town with class produced ending in (now − window, now], k = progress 0..1 over 6 s then parked); `CityKit.tsx` `HoverCars` → `Deliveries` drawing a car per item (hall → house spot or street). Test `tests/deliveries.test.ts`.

### Task 5: Questions in the events (B1)
Claude adapter: tool_start of `AskUserQuestion` carries `ask: { questions: {question, header?, multiSelect, options: {label, description?}[]}[] }` (schema `AgentTownEvent.ask`); `CACHE_VERSION` +1. Attention entries get `ask` from their open call. Tests: adapters + attention.

### Task 6: The ask server (B2, B4, B5)
`packages/server/src/ask.ts`: `createAsks({ now, holdMs = 120000, watchMs = 25000 })` → `{ hold(src, input, respond) , answer(id, answer) , release(id) , heartbeat() , watching() , pending() , settle(attention) }`; http routes `POST /api/ask?src=` (hook; holds or answers empty), `GET /api/asks`, `POST /api/ask/answer` {id, answers|behavior} (token), `POST /api/ask/release` {id} (token), `POST /api/presence` (page heartbeat), `/api/status` gains `token`; SSE event `asks`. Hooks: `installAskHook/uninstallAskHook` (Claude settings.json PermissionRequest matcher `*`, command `curl -s -m 130 … /api/ask?src=claude || true`, timeout 135; Codex hooks.json PermissionRequest). Tests `tests/ask.test.ts` (hold only while watched; answer → hook JSON shapes for question/approval, claude/codex; release → empty; timeout → empty; settle on log result → empty; token required; install/uninstall keeps others' hooks).

### Task 7: The decision panel (B3, B6)
`ui/Decision.tsx` (questions → radio/checkbox + 其他; approvals → Allow/Deny + what runs; "在终端里回答"), opened from 需要你 rows with a pending ask ("选择") and from the mini window; presence heartbeat in main.tsx; settings switch "在页面上回答（安装 hook）"; notification text for asks. Pure `answerOf(questions, picks)` tested. e2e `decision.spec.ts` with a fake held hook (curl to the dev proxy) answered from the page.

### Task 8: Overview tab (C)
`city/overview.ts` `townOverview(w25, townKey, now)` pure; `HistoryPanel` becomes a tabbed right panel (Overview | History), opening on Overview. Tests `tests/overview.test.ts`; e2e history.spec adjusted.

### Finish
Unit + e2e (serial for flaky load), real tmux run against the real server (B), real-data looks, review (sonnet), D26 in decisions.md, merge on the owner's word.
