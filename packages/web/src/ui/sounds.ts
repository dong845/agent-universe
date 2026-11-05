// Sounds (spec 2026-11-05 C4), off unless switched on in the settings: a soft chime when a turn finishes,
// a two-note call when a session starts waiting for you. Made with Web Audio (no files), quiet, at most
// one every 3 s.
import type { Attention } from "../../../schema/src/attention.ts";

export type Sound = "done" | "waiting";
const KEY = "agent-universe:sounds";

export function soundsOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}
export function setSoundsOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // not remembered
  }
}

/** a player that refuses to play again within `minGapMs`; returns whether it played */
export function makeChimer(play: (k: Sound) => void, minGapMs = 3000) {
  let last = -Infinity;
  return (k: Sound, now: number): boolean => {
    if (now - last < minGapMs) return false;
    last = now;
    play(k);
    return true;
  };
}

/** what newly happened between two 需要你 lists: someone started waiting, a turn finished (once each) */
export function attentionSounds(prev: readonly Attention[], next: readonly Attention[]): Sound[] {
  const was = new Map(prev.map((a) => [a.session, `${a.state}|${a.since}`]));
  const fresh = next.filter((a) => was.get(a.session) !== `${a.state}|${a.since}`);
  const out: Sound[] = [];
  if (fresh.some((a) => a.state === "waiting" || a.state === "maybe-waiting")) out.push("waiting");
  if (fresh.some((a) => a.state === "turn-done")) out.push("done");
  return out;
}

let audio: AudioContext | null = null;
/** two soft sine notes with a gentle envelope; quiet (gain ≤ 0.08) */
export function playSound(k: Sound) {
  const Ctx = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) return;
  audio ??= new Ctx();
  const notes = k === "done" ? [880, 1318.5] : [659.3, 523.3];
  notes.forEach((f, i) => {
    const t0 = audio!.currentTime + i * 0.16;
    const o = audio!.createOscillator();
    const g = audio!.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.08, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    o.connect(g).connect(audio!.destination);
    o.start(t0);
    o.stop(t0 + 0.55);
  });
}
