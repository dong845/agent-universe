// What a 需要你 row offers (spec 2026-11-07 D27 B4). A session waiting in its terminal is alive: resuming
// it would open a second copy, so it is answered on the page (when the hook holds it) or in the terminal.
import type { AttentionState } from "../../../schema/src/attention.ts";

export type NeedAction = "decide" | "terminal" | "enable" | "resume";

/** held: the page holds a decision for this session; hookOn: the ask hook of its side (null: unknown, no server) */
export function needAction(a: { state: AttentionState; ask?: unknown }, held: boolean, hookOn: boolean | null): NeedAction {
  if (held || a.ask) return "decide";
  if (a.state === "waiting" || a.state === "maybe-waiting") return hookOn === false ? "enable" : "terminal";
  return "resume";
}
