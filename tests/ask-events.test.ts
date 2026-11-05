// A question with options in the record (spec 2026-11-05 D26 B1): the event keeps the questions, and
// 需要你 says the session waits for a choice at once — in any permission mode.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeSession } from "../packages/adapter-claude/src/index.ts";
import { attentionOf } from "../packages/schema/src/attention.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { loadRoles } from "../packages/schema/src/roles.ts";
import { newStats } from "../packages/schema/src/util.ts";

const T0 = Date.UTC(2026, 10, 5, 9);
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const QUESTIONS = [
  { question: "Pick a color", header: "Color", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }] },
  { question: "Which sizes?", header: "Size", multiSelect: true, options: [{ label: "S" }, { label: "M" }] },
];

function session(withAnswer: boolean): string {
  const dir = join(mkdtempSync(join(tmpdir(), "at-ask-")), "-synthetic-ask");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "ask-1.jsonl");
  const b = (s: number, extra: object) => JSON.stringify({ sessionId: "ask-1", cwd: "/synthetic/ask", timestamp: at(s), uuid: `u${s}`, ...extra });
  const lines = [
    JSON.stringify({ type: "permission-mode", permissionMode: "auto", sessionId: "ask-1" }),
    b(1, { type: "user", origin: { kind: "human" }, message: { role: "user", content: "make it" } }),
    b(2, { type: "assistant", message: { id: "m1", model: "m", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu-ask", name: "AskUserQuestion", input: { questions: QUESTIONS } }] } }),
  ];
  if (withAnswer) lines.push(b(9, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-ask", content: "Your questions have been answered" }] } }));
  writeFileSync(f, lines.join("\n") + "\n");
  return f;
}

describe("AskUserQuestion in the record", () => {
  it("the call keeps its questions and options", () => {
    const r = parseClaudeSession(session(false), loadRoles(), newStats());
    const call = r.events.find((e) => e.kind === "tool_start" && e.tool === "AskUserQuestion")!;
    expect(call.ask).toEqual(QUESTIONS.map((q) => ({ question: q.question, header: q.header, multiSelect: q.multiSelect, options: q.options })));
  });
  it("needs you at once, even in auto mode, with the questions", () => {
    const evs: AgentTownEvent[] = parseClaudeSession(session(false), loadRoles(), newStats()).events;
    const a = attentionOf(evs, T0 + 3000, [], new Map());
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ state: "waiting", tool: "AskUserQuestion", exact: true });
    expect(a[0].ask?.[0].options.map((o) => o.label)).toEqual(["Red", "Blue"]);
  });
  it("answered: nothing waits", () => {
    const evs = parseClaudeSession(session(true), loadRoles(), newStats()).events;
    expect(attentionOf(evs, T0 + 10_000, [], new Map()).filter((x) => x.state === "waiting")).toEqual([]);
  });
});
