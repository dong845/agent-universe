// The agent character's rules (spec 2026-11-05 A3/A4): which face a figure shows for its pose, and which
// prop a subagent carries. The shapes and colours live in art/character.json, shared with the Blender
// model script, so the 3D model and the 2D face never drift.
import character from "../../../../art/character.json" with { type: "json" };
import type { Role } from "../../../schema/src/event.ts";
import type { Actor, Pose } from "../orchestrator/timeline.ts";

export const FACES = ["normal", "focus", "think", "wide", "error", "happy", "sleepy"] as const;
export type Face = (typeof FACES)[number];
export const PROPS = ["magnifier", "pencil", "hardhat", "glasses", "dish", "clipboard", "beret", "goggles", "bowtie", "shield", "backpack"] as const;
export type Prop = (typeof PROPS)[number];

/** a minute of standing about without being done makes a figure sleepy */
export const SLEEPY_MS = 60_000;

const POSE_FACE: Record<Pose, Face> = {
  idle: "normal", walk: "normal", carry: "normal", report: "normal", dispatch: "normal",
  work: "focus", think: "think", pack: "think", raise_hand: "wide", shake: "error", fall: "error",
};

/** the face for a pose; `done` = after its request ended; `idleMs` = how long it has stood idle */
export function faceOf(s: { pose: Pose; done: boolean; idleMs: number }): Face {
  const f = POSE_FACE[s.pose];
  if (f === "error") return f;
  if (s.done) return "happy";
  if (s.pose === "idle" && s.idleMs >= SLEEPY_MS) return "sleepy";
  return f;
}

export const ROLE_PROP = character.props as Partial<Record<Role, Prop>>;
for (const [role, prop] of Object.entries(ROLE_PROP)) {
  if (!(PROPS as readonly string[]).includes(prop)) throw new Error(`art/character.json: role ${role} has unknown prop "${prop}"`);
}

/** a subagent's kind of work: its own role; a general subagent's: the work it has done most by `t` (ties:
 * the work it did first); null before any work, and for a main agent */
export function workOf(actor: Actor, t: number): Role | null {
  if (actor.kind === "commander") return null;
  if (ROLE_PROP[actor.baseRole]) return actor.baseRole;
  const n = new Map<Role, { n: number; first: number }>();
  for (const a of actor.actions) {
    if (a.start > t || !ROLE_PROP[a.outfit]) continue;
    const c = n.get(a.outfit);
    if (c) c.n++;
    else n.set(a.outfit, { n: 1, first: a.start });
  }
  let best: Role | null = null;
  for (const [r, c] of n) {
    const b = best ? n.get(best)! : null;
    if (!b || c.n > b.n || (c.n === b.n && c.first < b.first)) best = r;
  }
  return best;
}

/** a subagent's prop: the one for its kind of work (workOf); before any work, a backpack. A main agent
 * carries none. */
export function propOf(actor: Actor, t: number): Prop | null {
  if (actor.kind === "commander") return null;
  const w = workOf(actor, t);
  return w ? ROLE_PROP[w]! : "backpack";
}
