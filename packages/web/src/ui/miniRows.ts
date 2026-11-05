// The mini window's rows (spec 2026-11-05 C2): sessions waiting on you first (as in 需要你), then each
// request in progress with what it is doing now and for how long. Pure; MiniWindow.tsx words and draws.
import { ATTENTION, type Attention, type AttentionState } from "../../../schema/src/attention.ts";
import type { AgentTownEvent, Faction, Role } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";
import type { Face } from "../character/rules.ts";
import { visibleAttention } from "./dismiss.ts";

export interface MiniRow {
  key: string;
  /** the town's key and its shown name */
  townKey: string;
  town: string;
  faction: Faction;
  face: Face;
  /** the open tool call (working rows), null when between calls */
  doing: { role?: Role; tool?: string } | null;
  state?: AttentionState;
  sinceMs: number;
  attention?: Attention;
}

const FACE_OF: Record<AttentionState, Face> = { waiting: "wide", "maybe-waiting": "wide", error: "error", "turn-done": "happy" };

export function miniRows(input: {
  w: { live: Set<string>; requests: Map<string, Pick<RequestRow, "requestId" | "faction" | "projectId" | "taskIds">> };
  events: readonly AgentTownEvent[];
  attention: Attention[];
  closed: Record<string, string>;
  /** wall-clock now, for the waiting rows (their `since` is real time) */
  now: number;
  /** the scene's clock, for the working rows (default: now); a request quiet for longer than
   * ATTENTION.liveWindowMs is not shown as working */
  clock?: number;
  names: (townKey: string) => string;
}): { attention: MiniRow[]; live: MiniRow[] } {
  const clock = input.clock ?? input.now;
  const att = visibleAttention(input.attention, input.closed);
  const attention = att.map((a): MiniRow => {
    const townKey = `${a.faction}|${a.projectId}`;
    return { key: a.session, townKey, town: input.names(townKey), faction: a.faction, face: FACE_OF[a.state], doing: a.tool ? { tool: a.tool } : null, state: a.state, sinceMs: Math.max(0, input.now - a.since), attention: a };
  });
  const waiting = new Set(att.map((a) => a.requestId).filter(Boolean));
  // each live request's newest event, and its open tool call
  const taskOf = new Map<string, string>();
  for (const id of input.w.live) {
    if (waiting.has(id)) continue;
    const r = input.w.requests.get(id);
    if (r) for (const t of r.taskIds) taskOf.set(t, id);
  }
  const last = new Map<string, number>();
  const open = new Map<string, Map<string, AgentTownEvent>>();
  for (const e of input.events) {
    const id = e.taskId ? taskOf.get(e.taskId) : undefined;
    if (!id || e.ts > clock) continue;
    last.set(id, Math.max(last.get(id) ?? -Infinity, e.ts));
    const o = open.get(id) ?? new Map<string, AgentTownEvent>();
    open.set(id, o);
    if (e.kind === "tool_start") o.set(e.toolUseId ?? e.id, e);
    else if (e.kind === "tool_end" && e.toolUseId) o.delete(e.toolUseId);
  }
  const live = [...last.keys()].map((id): MiniRow & { at: number } => {
    const r = input.w.requests.get(id)!;
    const townKey = `${r.faction}|${r.projectId}`;
    let now: AgentTownEvent | undefined;
    for (const e of open.get(id)?.values() ?? []) if (!now || e.ts >= now.ts) now = e;
    const at = last.get(id)!;
    return { key: id, townKey, town: input.names(townKey), faction: r.faction, face: now ? "focus" : "think", doing: now ? { ...(now.role ? { role: now.role } : {}), ...(now.tool ? { tool: now.tool } : {}) } : null, sinceMs: Math.max(0, clock - (now ? now.ts : at)), at };
  }).filter((r) => clock - r.at <= ATTENTION.liveWindowMs);
  live.sort((a, b) => b.at - a.at);
  return { attention, live: live.map(({ at: _, ...row }) => row) };
}
