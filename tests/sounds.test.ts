// Sounds (spec 2026-11-05 C4): at most one per 3 s, and only for what newly happened.
import { describe, expect, it } from "vitest";
import type { Attention } from "../packages/schema/src/attention.ts";
import { attentionSounds, makeChimer } from "../packages/web/src/ui/sounds.ts";

const a = (session: string, state: Attention["state"], since = 1): Attention => ({ session, faction: "codex", sessionId: session, projectId: "/p", requestId: null, state, since, exact: false });

describe("makeChimer", () => {
  it("plays, then keeps quiet for 3 s", () => {
    const played: string[] = [];
    const chime = makeChimer((k) => played.push(k));
    expect(chime("done", 1000)).toBe(true);
    expect(chime("waiting", 3999)).toBe(false);
    expect(chime("waiting", 4000)).toBe(true);
    expect(played).toEqual(["done", "waiting"]);
  });
});

describe("attentionSounds", () => {
  it("nothing new, no sound", () => {
    expect(attentionSounds([a("s1", "waiting")], [a("s1", "waiting")])).toEqual([]);
    expect(attentionSounds([a("s1", "waiting")], [])).toEqual([]);
  });
  it("a session starting to wait calls; a finished turn chimes; once each", () => {
    expect(attentionSounds([], [a("s1", "waiting"), a("s2", "maybe-waiting")])).toEqual(["waiting"]);
    expect(attentionSounds([a("s1", "maybe-waiting")], [a("s1", "turn-done", 5)])).toEqual(["done"]);
    expect(attentionSounds([], [a("s1", "turn-done"), a("s2", "waiting")])).toEqual(["waiting", "done"]);
  });
  it("an error is not a sound of its own (it shows as 需要你)", () => {
    expect(attentionSounds([], [a("s1", "error")])).toEqual([]);
  });
});
