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
  "empty.badge": "Demo world · no logs of yours found",
  "empty.title": "No logs found",
  "empty.body": "This is a demo world. Agent Universe reads logs from the two folders below and switches to your own world as soon as there are some:",
};
