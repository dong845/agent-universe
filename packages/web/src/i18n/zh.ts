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
  "common.close": "关闭",
  "empty.badge": "演示世界 · 没有找到你的日志",
  "empty.title": "没有找到日志",
  "empty.body": "现在看到的是演示世界。Agent Universe 从下面两个文件夹读取日志，有了日志会自动换成你的世界：",
} as const;
export type Key = keyof typeof zh;
