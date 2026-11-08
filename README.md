# Agent Universe · 智能体宇宙

[中文说明](README.zh.md)

Your Claude Code and Codex work, drawn as a universe that grows with it. Everything is read from the
logs on your own computer and shown only there.

- **Two stars**: Claude Code and Codex. Each finished product lights one panel of the star's Dyson shell.
- **Planets are projects** (and skill guilds), bigger the more they produced. Click one to fly there and
  land in its **city**: buildings for products and kinds of work, robots for the agents working now —
  the main agent and its subagents.
- **需要你**: sessions waiting on you — maybe waiting for an approval, stopped on an error, a turn
  finished — with macOS notifications and a one-click resume command. Optional hooks make approval
  waits exact.
- **历史**: a town's requests as steps; pick one and the city stands as it was when that request
  finished, explained from what the logs record.
- **The agents** are little big-headed robots: their faces show what they are doing (focused, thinking,
  waiting for you, an error, done), subagents carry a tool for their kind of work, and a click on one
  makes the camera follow it, with a card saying what it is doing right now.
- **Mini window**: a small always-on-top window (Chrome/Edge) with who is working and who waits for you.
- **Review poster**: the last 7 / 30 / 365 days or all time as one picture to share.
- **Share**: record a replay as MP4/GIF, or export the world as one offline HTML page. Project names
  are kept, request titles hidden, paths and session ids never included.
- **Chinese or English**: follows your browser; the 中文 / English button switches. Optional sounds, and
  a small celebration for milestones reached while the page is open. A guided tour on the first visit.

## Start

Needs **Node 22.18 or newer** (from nodejs.org); macOS or Linux.

```
npx agent-universe
```

It starts at http://127.0.0.1:5182/ and opens the browser (the page comes prebuilt). In Claude Code you can
also install the plugin and type `/agent-universe`:

```
/plugin marketplace add dong845/agent-universe-plugin
/plugin install agent-universe@agent-universe
```

From the source:

```
git clone <this repository> agent-universe
cd agent-universe
npm start
```

The first run installs the dependencies (with the pnpm that Node's corepack ships) and builds the
page; then the server starts at http://127.0.0.1:5182/ and the browser opens. With no logs yet you see
a demo world, and a note saying where Agent Universe reads from: `~/.claude/projects` (Claude Code)
and `~/.codex/sessions` (Codex). Options: `npx agent-universe --port 5190 --no-open` (from the source: `npm start -- --port 5190 --no-open`).

The server listens on 127.0.0.1 only and sends nothing anywhere. Its own files live in
`~/.agent-town/` (cache, settings, the share secret, downloaded marks).

## The official marks

Claude's and OpenAI's marks are not part of this repository; they belong to Anthropic and OpenAI. In
the settings (⚙), "官方标志（仅本机显示）" downloads them from Wikimedia Commons into
`~/.agent-town/logos/` and shows them on your machine only. Without them, and in every export, the
page uses its own neutral marks.

## For development

```
node --run dev        # Vite dev server on 5180 (proxies /api to 5182)
node --run serve      # the local server alone
node --run test       # unit tests (vitest)
node --run e2e        # browser tests in the installed Chrome (needs the dev server and a build)
```

Design and decisions: [docs/decisions.md](docs/decisions.md); log formats:
[docs/log-formats.md](docs/log-formats.md); specs and plans under `docs/superpowers/`.
