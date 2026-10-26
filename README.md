# Agent Town

Local 3D view of Claude Code and Codex sessions: every agent a faction, every task a building site,
tokens the material the workers carry. macOS only for the first version.

Status: phase 0 (log-format verification). Findings: [docs/log-formats.md](docs/log-formats.md).

```
node scripts/parse.ts                      # parse ~/.claude/projects and ~/.codex/sessions, print counts
node scripts/parse.ts --events out.jsonl   # also write the unified events
```

Decisions that revise the plan: [docs/decisions.md](docs/decisions.md). Needs Node 22.18+ (runs TypeScript directly).
