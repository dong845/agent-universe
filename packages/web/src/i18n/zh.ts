// Chinese interface text (spec 2026-11-05 D). Every user-facing string of the page lives here and in en.ts.
export const zh = {
  "common.calls": "{n} 次调用",
  "gist.edit": "改了 {n} 个文件：{files}",
  "gist.more": " 等",
  "gist.sep": "、",
  "gist.run": "跑命令：{command}",
  "gist.web": "联网：{query}",
  "gist.read": "读了 {n} 个文件",
  "gist.calls": "调用了 {n} 次工具",
  "history.untitled": "（无标题）",
} as const;
export type Key = keyof typeof zh;
