// The decision panel's answers (spec 2026-11-05 D26 B3): keyed by question text, labels joined.
import { describe, expect, it } from "vitest";
import { answerOf, complete } from "../packages/web/src/ui/decision.ts";

const qs = [
  { question: "Pick a color", multiSelect: false, options: [{ label: "Red" }, { label: "Blue" }] },
  { question: "Which sizes?", multiSelect: true, options: [{ label: "S" }, { label: "M" }, { label: "L" }] },
];

describe("answerOf", () => {
  it("one label for a single choice, labels joined for several, keyed by the question", () => {
    expect(answerOf(qs, { "Pick a color": { labels: ["Blue"] }, "Which sizes?": { labels: ["S", "L"] } })).toEqual({ "Pick a color": "Blue", "Which sizes?": "S, L" });
  });
  it("one's own words replace the options", () => {
    expect(answerOf(qs, { "Pick a color": { labels: ["Red"], other: "  green please " }, "Which sizes?": { labels: ["M"] } })["Pick a color"]).toBe("green please");
  });
  it("complete only when every question has an answer", () => {
    expect(complete(qs, { "Pick a color": { labels: ["Red"] } })).toBe(false);
    expect(complete(qs, { "Pick a color": { labels: ["Red"] }, "Which sizes?": { labels: [], other: "XL" } })).toBe(true);
    expect(complete(qs, { "Pick a color": { labels: [] }, "Which sizes?": { labels: ["S"] } })).toBe(false);
  });
});

describe("a held question with no 需要你 entry yet (a session not read yet)", () => {
  it("still gets a row", async () => {
    const { withAsks } = await import("../packages/web/src/ui/decision.ts");
    const ask = { id: "a1", src: "claude" as const, session: "claude-code|new", sessionId: "new", tool: "AskUserQuestion", kind: "question" as const, questions: qs, cwd: "/w/new-project", since: 5 };
    const rows = withAsks([], [ask]);
    expect(rows).toEqual([{ session: "claude-code|new", faction: "claude-code", sessionId: "new", projectId: "/w/new-project", requestId: null, state: "waiting", since: 5, tool: "AskUserQuestion", exact: true, ask: qs }]);
    const att = { session: "claude-code|new", faction: "claude-code" as const, sessionId: "new", projectId: "/p", requestId: null, state: "maybe-waiting" as const, since: 1, exact: false };
    expect(withAsks([att], [ask])).toEqual([att]);
  });
});
