// Tail parsing (spec 2026-11-03 A1): a log that only grew is read from where the parser stopped, and the
// result must be exactly what a full parse of the same files gives — after every single appended line.
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeLive, parseClaudeSession } from "../packages/adapter-claude/src/index.ts";
import { CodexLive, parseCodexThread, rolloutHead, type RolloutHead } from "../packages/adapter-codex/src/index.ts";
import { loadRoles } from "../packages/schema/src/roles.ts";
import { newStats } from "../packages/schema/src/util.ts";

const roles = loadRoles();
const T0 = Date.UTC(2026, 10, 3, 9);
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const J = (o: unknown) => JSON.stringify(o) + "\n";

/** one Claude session as a list of writes, in the order they happen: main lines and a subagent's lines interleaved */
function claudeWrites(dir: string) {
  const sid = "inc-c";
  const proj = join(dir, "-synthetic-inc");
  const main = join(proj, `${sid}.jsonl`);
  const subDir = join(proj, sid, "subagents");
  const sub = join(subDir, "agent-s1.jsonl");
  const meta = join(subDir, "agent-s1.meta.json");
  const b = (s: number, extra: object) => ({ sessionId: sid, cwd: "/synthetic/inc", timestamp: at(s), uuid: `u${s}`, ...extra });
  const usage = (o: number) => ({ input_tokens: 10, output_tokens: o, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 });
  const writes: { file: string; text: string }[] = [
    { file: main, text: J({ type: "permission-mode", permissionMode: "default", sessionId: sid }) },
    { file: main, text: J(b(1, { type: "user", origin: { kind: "human" }, message: { role: "user", content: "first task" } })) },
    { file: main, text: J(b(2, { type: "assistant", message: { id: "m1", model: "claude-test", usage: usage(5), content: [{ type: "tool_use", id: "tu-read", name: "Read", input: { file_path: "/synthetic/inc/a.ts" } }] } })) },
    { file: main, text: J(b(3, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-read", content: "ok" }] } })) },
    { file: main, text: J(b(4, { type: "assistant", message: { id: "m2", model: "claude-test", usage: usage(7), content: [{ type: "tool_use", id: "tu-agent", name: "Agent", input: { description: "look around", prompt: "go" } }] } })) },
    { file: meta, text: JSON.stringify({ agentType: "Explore", toolUseId: "tu-agent", description: "look around" }) },
    { file: sub, text: J(b(5, { type: "user", isSidechain: true, message: { role: "user", content: "go" } })) },
    { file: sub, text: J(b(6, { type: "assistant", isSidechain: true, message: { id: "s1", model: "claude-test", usage: usage(3), content: [{ type: "tool_use", id: "tu-grep", name: "Grep", input: { pattern: "x" } }] } })) },
    { file: sub, text: J(b(7, { type: "user", isSidechain: true, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-grep", content: "ok" }] } })) },
    // the same message again with more output: a later line of one message replaces its tokens
    { file: sub, text: J(b(8, { type: "assistant", isSidechain: true, message: { id: "s1", model: "claude-test", usage: usage(9), content: [{ type: "text", text: "done" }] } })) },
    { file: main, text: J(b(9, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-agent", content: "found" }] } })) },
    { file: main, text: J(b(10, { type: "system", subtype: "turn_duration", durationMs: 9000 })) },
    { file: main, text: J({ type: "permission-mode", permissionMode: "acceptEdits", sessionId: sid }) },
    { file: main, text: J(b(11, { type: "user", origin: { kind: "human" }, message: { role: "user", content: "second task" } })) },
    { file: main, text: J(b(12, { type: "assistant", message: { id: "m3", model: "claude-test", usage: usage(2), content: [{ type: "tool_use", id: "tu-edit", name: "Edit", input: { file_path: "/synthetic/inc/a.ts" } }] } })) },
    { file: main, text: J(b(13, { type: "assistant", message: { id: "m3", model: "claude-test", usage: usage(30), content: [{ type: "text", text: "editing" }] } })) },
    { file: main, text: "\n" },
    { file: main, text: J(b(14, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-edit", content: "ok" }] } })) },
  ];
  return { main, subDir, writes };
}

function apply(w: { file: string; text: string }) {
  mkdirSync(join(w.file, ".."), { recursive: true });
  if (w.file.endsWith(".meta.json")) writeFileSync(w.file, w.text);
  else appendFileSync(w.file, w.text);
}

describe("Claude: tail parsing equals a full parse after every appended line", () => {
  it("a session with a subagent, token growth, a blank line and an open task", () => {
    const dir = mkdtempSync(join(tmpdir(), "at-inc-c-"));
    const { main, writes } = claudeWrites(dir);
    const live = new ClaudeLive(main, roles);
    let tails = 0;
    for (const w of writes) {
      apply(w);
      const r = live.update(newStats());
      if (r.mode === "tail") tails++;
      const full = parseClaudeSession(main, roles, newStats());
      expect(r.events).toEqual(full.events);
      expect(r.totals).toEqual(full.totals);
    }
    // after the first read, growth is read from where the parser stopped
    expect(tails).toBeGreaterThan(writes.length - 4);
  });
  it("a half line at the end waits for its newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "at-inc-c-"));
    const { main, writes } = claudeWrites(dir);
    for (const w of writes.slice(0, 4)) apply(w);
    const live = new ClaudeLive(main, roles);
    live.update(newStats());
    const line = writes[4].text;
    appendFileSync(main, line.slice(0, 40));
    const half = live.update(newStats());
    appendFileSync(main, line.slice(40));
    const r = live.update(newStats());
    expect(half.events.some((e) => e.toolUseId === "tu-agent")).toBe(false);
    expect(r.events).toEqual(parseClaudeSession(main, roles, newStats()).events);
  });
  it("a file that shrank or was replaced is read again from the start", () => {
    const dir = mkdtempSync(join(tmpdir(), "at-inc-c-"));
    const { main, writes } = claudeWrites(dir);
    for (const w of writes) apply(w);
    const live = new ClaudeLive(main, roles);
    live.update(newStats());
    writeFileSync(main, writes.filter((w) => w.file === main).slice(0, 3).map((w) => w.text).join(""));
    const r = live.update(newStats());
    expect(r.mode).toBe("full");
    expect(r.events).toEqual(parseClaudeSession(main, roles, newStats()).events);
  });
});

/** a Codex thread: the root rollout and a child that a spawn_agent call names */
function codexWrites(dir: string) {
  const d = join(dir, "2026", "11", "03");
  const root = join(d, "rollout-root.jsonl");
  const child = join(d, "rollout-child.jsonl");
  const r = (s: number, type: string, payload: object) => ({ type, timestamp: at(s), payload });
  const total = (n: number) => ({ input_tokens: 100 * n, cached_input_tokens: 50 * n, output_tokens: 10 * n, reasoning_output_tokens: 0, total_tokens: 110 * n });
  const writes: { file: string; text: string }[] = [
    { file: root, text: J(r(0, "session_meta", { id: "th-root", cwd: "/synthetic/inc", timestamp: at(0) })) },
    { file: root, text: J(r(1, "turn_context", { model: "codex-test", cwd: "/synthetic/inc", approval_policy: "on-request" })) },
    { file: root, text: J(r(2, "event_msg", { type: "task_started", turn_id: "t1" })) },
    { file: root, text: J(r(3, "event_msg", { type: "user_message", message: "build it" })) },
    { file: root, text: J(r(4, "response_item", { type: "function_call", name: "spawn_agent", arguments: "{}", call_id: "c-spawn" })) },
    { file: child, text: J(r(5, "session_meta", { id: "th-child", cwd: "/synthetic/inc", timestamp: at(5), source: { subagent: { thread_spawn: { parent_thread_id: "th-root", agent_role: "worker", agent_nickname: "helper" } } } })) },
    { file: root, text: J(r(6, "response_item", { type: "function_call_output", call_id: "c-spawn", output: '{"agent_id":"th-child"}' })) },
    { file: child, text: J(r(7, "response_item", { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "ls" }), call_id: "c-ls" })) },
    { file: child, text: J(r(8, "response_item", { type: "function_call_output", call_id: "c-ls", output: "Process exited with code 0" })) },
    { file: child, text: J(r(9, "event_msg", { type: "token_count", info: { total_token_usage: total(1), last_token_usage: total(1), model_context_window: 1000 } })) },
    { file: root, text: J(r(10, "event_msg", { type: "token_count", info: { total_token_usage: total(2), last_token_usage: total(2), model_context_window: 1000 } })) },
    { file: root, text: J(r(11, "event_msg", { type: "task_complete", turn_id: "t1" })) },
    { file: root, text: J(r(12, "event_msg", { type: "task_started", turn_id: "t2" })) },
  ];
  return { root, writes };
}

const heads = (paths: string[]): RolloutHead[] => {
  const hs = paths.map((p) => { try { return rolloutHead(p, newStats()); } catch { return undefined; } }).filter((h): h is RolloutHead => !!h);
  return [...hs.filter((h) => !h.parentId), ...hs.filter((h) => h.parentId)];
};

describe("Codex: tail parsing equals a full parse after every appended line", () => {
  it("a thread whose child appears midway", () => {
    const dir = mkdtempSync(join(tmpdir(), "at-inc-x-"));
    const { root, writes } = codexWrites(dir);
    const live = new CodexLive(roles);
    for (const w of writes) {
      apply(w);
      const hs = heads([root, join(root, "..", "rollout-child.jsonl")].filter((p) => { try { return !!rolloutHead(p, newStats()); } catch { return false; } }));
      const r = live.update(hs, newStats());
      const full = parseCodexThread(hs, roles, newStats());
      expect(r.events).toEqual(full.events);
      expect([...r.fileTotals]).toEqual([...full.fileTotals]);
    }
  });
});
