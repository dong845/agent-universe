// English interface text (spec 2026-11-05 D): the same keys as zh.ts — a missing one is a type error.
import type { Key } from "./zh.ts";

export const en: Record<Key, string> = {
  "common.calls": "{n} calls",
  "gist.edit": "Edited {n} files: {files}",
  "gist.more": " …",
  "gist.sep": ", ",
  "gist.run": "Ran: {command}",
  "gist.web": "Web: {query}",
  "gist.read": "Read {n} files",
  "gist.calls": "{n} tool calls",
  "history.untitled": "(untitled)",
  "common.close": "Close",
  "follow.main": "Main agent",
  "follow.sub": "Subagent",
  "follow.doing": "Doing",
  "follow.idle": "no call in progress",
  "follow.since": "For",
  "follow.children": "Subagents it sent ({n})",
  "follow.parent": "↑ Follow the agent that sent it",
  "search.placeholder": "Find a project… ( / )",
  "search.label": "Find a project by name",
  "search.none": "No project by that name",
  "empty.badge": "Demo world · no logs of yours found",
  "empty.title": "No logs found",
  "empty.body": "This is a demo world. Agent Universe reads logs from the two folders below and switches to your own world as soon as there are some:",
};
