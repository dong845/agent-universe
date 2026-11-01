// macOS notifications for sessions that need the owner (spec 2026-11-01 A5). One per (session, state)
// transition; a state that repeats is not news. Clicking one opens nothing (no helper app is installed),
// so the text says where to look.
import { execFile } from "node:child_process";
import type { Attention, AttentionState } from "../../schema/src/attention.ts";
import type { Settings } from "./settings.ts";

const TEXT: Record<AttentionState, string> = { "maybe-waiting": "可能在等你授权", waiting: "在等你授权", "turn-done": "本轮完成，等你回复", error: "出错停止" };
export const notificationText = (s: AttentionState) => TEXT[s];

export function createNotifier(send: (title: string, body: string) => void, settings: () => Settings, townName: (projectId: string, faction: Attention["faction"]) => string): (list: Attention[]) => void {
  let shown = new Map<string, AttentionState>();
  return (list) => {
    const s = settings();
    const next = new Map<string, AttentionState>();
    for (const a of list) {
      next.set(a.session, a.state);
      if (shown.get(a.session) === a.state) continue;
      if (!s.notify) continue;
      if (a.state === "turn-done" && !s.notifyTurnDone) continue;
      send("Agent Town", `${townName(a.projectId, a.faction)} · ${TEXT[a.state]}`);
    }
    shown = next;
  };
}

/** an AppleScript string literal */
export function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

let warned = false;
export function osascriptSend(title: string, body: string): void {
  execFile("osascript", ["-e", `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`], (err) => {
    if (err && !warned) {
      warned = true;
      console.error(`发送通知失败（之后不再提示）：${err.message}`);
    }
  });
}
