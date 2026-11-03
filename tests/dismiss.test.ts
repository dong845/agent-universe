// Closing a 需要你 entry (owner 2026-11-03): it stays closed until that session changes — a new state or
// a newer moment — and comes back then.
import { describe, expect, it } from "vitest";
import type { Attention } from "../packages/schema/src/attention.ts";
import { dismissKey, visibleAttention } from "../packages/web/src/ui/dismiss.ts";

const a = (session: string, state: Attention["state"], since: number): Attention => ({ session, faction: "claude-code", sessionId: session, projectId: "/p", requestId: null, state, since, exact: false });

describe("visibleAttention", () => {
  it("hides a closed entry, keeps the others", () => {
    const list = [a("s1", "turn-done", 100), a("s2", "error", 50)];
    expect(visibleAttention(list, { s1: dismissKey(list[0]) }).map((x) => x.session)).toEqual(["s2"]);
  });
  it("brings it back when the session moves on: a new state, or the same state at a newer moment", () => {
    const closed = { s1: dismissKey(a("s1", "turn-done", 100)) };
    expect(visibleAttention([a("s1", "maybe-waiting", 100)], closed)).toHaveLength(1);
    expect(visibleAttention([a("s1", "turn-done", 200)], closed)).toHaveLength(1);
    expect(visibleAttention([a("s1", "turn-done", 100)], closed)).toHaveLength(0);
  });
});
