// Closing a 需要你 entry (owner 2026-11-03). A closed entry stays closed while its session stays as it
// was — same state, same moment — and comes back when the session moves on. Remembered in this
// browser (localStorage; the page works without it).
import type { Attention } from "../../../schema/src/attention.ts";

export const dismissKey = (a: Attention) => `${a.state}|${a.since}`;

export function visibleAttention(list: Attention[], closed: Record<string, string>): Attention[] {
  return list.filter((a) => closed[a.session] !== dismissKey(a));
}

const KEY = "agent-town:closed-attention";
export function loadClosed(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
export function saveClosed(c: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // private window or blocked storage: closing still works until the page reloads
  }
}
