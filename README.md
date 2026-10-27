# Agent Town

Local 3D view of Claude Code and Codex sessions: every agent a faction, every task a building site,
tokens the material the workers carry. macOS only for the first version.

Status: phase 0 — log formats verified, minimal parser, 3D prototype on simulated data. Findings: [docs/log-formats.md](docs/log-formats.md).

```
node scripts/parse.ts                      # parse ~/.claude/projects and ~/.codex/sessions, print counts
node scripts/parse.ts --events out.jsonl   # also write the unified events
```

Decisions that revise the plan: [docs/decisions.md](docs/decisions.md). Needs Node 22.18+ (runs TypeScript directly).

## 3D prototype (simulated data)

```
corepack pnpm install
corepack pnpm dev                     # http://127.0.0.1:5180  (?t=<ms>&paused=1 opens a fixed moment)
corepack pnpm test                    # unit tests: mock, ledger, rework, timeline (+ real fixtures if present)
corepack pnpm --filter @agent-town/web e2e   # browser tests in the installed Chrome
```

The demo task is invented. The page says so, and it is labelled 演示数据 (demo data).
