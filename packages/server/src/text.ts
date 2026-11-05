// The server's words in Chinese and English (spec 2026-11-05 D). Notifications and the messages the page
// shows use the language the page last chose (settings.lang); the terminal follows LANG.
export type Lang = "zh" | "en";

/** zh for a Chinese locale (LANG / LC_ALL / LC_MESSAGES = zh_*), English otherwise */
export function langOf(env: Record<string, string | undefined> = process.env): Lang {
  const v = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return v.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const TEXT = {
  zh: {
    "state.maybe-waiting": "可能在等你授权",
    "state.waiting": "在等你授权",
    "state.turn-done": "本轮完成，等你回复",
    "state.error": "出错停止",
    "notify.failed": "发送通知失败（之后不再提示）：{why}",
    "port.bad": "--port 需要 1–65535 之间的数字，收到 {v}",
    "port.inUse": "端口 {port} 已被占用：可能已经有一个 Agent Universe 在运行",
    "reload.failed": "重新读取日志失败，继续显示上一次的世界：{why}",
    "hooks.notChanged": "没有改动 {file}：{why}",
    "hooks.raced": "{file} 在读取后又被改动了（可能是 Claude Code 或 Codex 正在写它），没有写入，请再试一次",
    "export.needsBuild": "导出分享页需要网页构建：先运行 node --run start",
    "export.maxReplays": "最多带 5 个重放",
    "export.tooBig": "分享页 {mb} MB，超过上限：最大的部分是 {parts}",
    "export.oneScript": "分享页需要网页构建只有一个脚本，现在有 {n} 个（检查 vite 的分包设置）",
    "export.comment": "网页程序里含有 <!--，内联进分享页会让页面无法启动；请检查最近更新的依赖",
    "export.part.js": "网页程序", "export.part.css": "样式", "export.part.model": "{name} 模型", "export.part.world": "世界数据",
    "export.title": "Agent Universe · 智能体宇宙 · 分享",
    "logos.failed": "下载失败：{why}",
    "watch.stopped": "停止监视 {root}：{why}",
    "watch.failed": "无法监视 {root}：{why}",
    "serve.reading": "读取日志 {done}/{total}",
    "serve.ready": "已就绪：{n} 条事件，用时 {s} 秒（缓存 {cached}，重新解析 {parsed}，续读 {tailed}）",
    "serve.failed": "启动失败：{why}",
    "serve.portFile": "写端口文件失败：{why}",
    "serve.url": "Agent Universe · 智能体宇宙: {url}{loading}",
    "serve.loading": "（正在读取日志）",
    "serve.noBuild": "还没有网页构建：先运行 node --run build；开发时用 node --run dev 打开 http://127.0.0.1:5180/",
  },
  en: {
    "state.maybe-waiting": "may be waiting for your approval",
    "state.waiting": "waiting for your approval",
    "state.turn-done": "turn finished, waiting for your reply",
    "state.error": "stopped on an error",
    "notify.failed": "Could not send a notification (not shown again): {why}",
    "port.bad": "--port needs a number from 1 to 65535, got {v}",
    "port.inUse": "Port {port} is in use: an Agent Universe may already be running",
    "reload.failed": "Could not read the logs again; still showing the last world: {why}",
    "hooks.notChanged": "Did not change {file}: {why}",
    "hooks.raced": "{file} changed after it was read (Claude Code or Codex may be writing it); nothing written, please try again",
    "export.needsBuild": "Exporting a share page needs the web build: run node --run start first",
    "export.maxReplays": "At most 5 replays",
    "export.tooBig": "The share page is {mb} MB, over the limit: the biggest parts are {parts}",
    "export.oneScript": "A share page needs a web build with exactly one script; it has {n} (check vite's chunking)",
    "export.comment": "The web program contains <!--, which would stop an inlined share page from starting; check recently updated dependencies",
    "export.part.js": "web program", "export.part.css": "styles", "export.part.model": "{name} model", "export.part.world": "world data",
    "export.title": "Agent Universe · shared",
    "logos.failed": "Download failed: {why}",
    "watch.stopped": "Stopped watching {root}: {why}",
    "watch.failed": "Cannot watch {root}: {why}",
    "serve.reading": "Reading logs {done}/{total}",
    "serve.ready": "Ready: {n} events in {s} s (cached {cached}, parsed {parsed}, tail-read {tailed})",
    "serve.failed": "Could not start: {why}",
    "serve.portFile": "Could not write the port file: {why}",
    "serve.url": "Agent Universe: {url}{loading}",
    "serve.loading": " (reading the logs)",
    "serve.noBuild": "No web build yet: run node --run build first; in development, node --run dev opens http://127.0.0.1:5180/",
  },
} as const;
export type TextKey = keyof (typeof TEXT)["zh"];

export function say(lang: Lang, key: TextKey, vars: Record<string, string | number> = {}): string {
  return TEXT[lang][key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
