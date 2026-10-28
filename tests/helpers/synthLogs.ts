// Synthetic Claude Code and Codex logs for tests. Every path, prompt and number here is invented;
// tests never read the owner's real logs (docs/decisions.md, privacy).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Tokens } from "../../packages/schema/src/event.ts";

export interface SynthTool {
  name: string;
  input: Record<string, unknown>;
  isError?: boolean;
}

export interface SynthTurn {
  prompt: string;
  /** how the opening user line is marked: a human prompt (default), a peer hand-back, a meta line, a compaction summary */
  opener?: "human" | "peer" | "meta" | "compact";
  tools?: SynthTool[];
  tokens: Tokens;
  /** default true: the turn ends (turn_duration / task_complete) */
  end?: boolean;
}

export interface SynthSession {
  sessionId: string;
  cwd: string;
  t0: number;
  turns: SynthTurn[];
}

const iso = (ms: number) => new Date(ms).toISOString();

/** writes <dir>/<project-slug>/<sessionId>.jsonl in Claude Code's transcript shape */
export function writeClaudeSession(dir: string, s: SynthSession): string {
  const projDir = join(dir, s.cwd.replace(/[/\\]/g, "-"));
  mkdirSync(projDir, { recursive: true });
  const lines: unknown[] = [];
  let t = s.t0;
  let n = 0;
  const base = () => ({ sessionId: s.sessionId, cwd: s.cwd, timestamp: iso((t += 1000)), uuid: `${s.sessionId}-u${n++}` });
  s.turns.forEach((turn, ti) => {
    const op = turn.opener ?? "human";
    const mark = op === "human" ? { origin: { kind: "human" } } : op === "peer" ? { origin: { kind: "peer" }, isMeta: true } : op === "meta" ? { isMeta: true } : { isCompactSummary: true };
    lines.push({ ...base(), type: "user", ...mark, message: { role: "user", content: turn.prompt } });
    const tools = turn.tools ?? [];
    tools.forEach((tool, k) => {
      const id = `${s.sessionId}-t${ti}-${k}`;
      lines.push({ ...base(), type: "assistant", message: { id: `${s.sessionId}-m${ti}-${k}`, model: "claude-test-1", usage: k === 0 ? usage(turn.tokens) : usage(zero()), content: [{ type: "tool_use", id, name: tool.name, input: tool.input }] } });
      lines.push({ ...base(), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: !!tool.isError, content: "ok" }] } });
    });
    if (!tools.length) lines.push({ ...base(), type: "assistant", message: { id: `${s.sessionId}-m${ti}`, model: "claude-test-1", usage: usage(turn.tokens), content: [{ type: "text", text: "done" }] } });
    if (turn.end !== false) lines.push({ ...base(), type: "system", subtype: "turn_duration", durationMs: 1000 });
  });
  const path = join(projDir, `${s.sessionId}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

/** writes <dir>/2026/10/28/rollout-<sessionId>.jsonl in Codex's rollout shape */
export function writeCodexRollout(dir: string, s: SynthSession): string {
  const d = join(dir, "2026", "10", "28");
  mkdirSync(d, { recursive: true });
  const lines: unknown[] = [];
  let t = s.t0;
  const at = () => iso((t += 1000));
  lines.push({ type: "session_meta", timestamp: at(), payload: { id: s.sessionId, cwd: s.cwd, timestamp: iso(s.t0) } });
  lines.push({ type: "turn_context", timestamp: at(), payload: { model: "codex-test-1" } });
  const total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
  s.turns.forEach((turn, ti) => {
    if (turn.tokens.cacheWrite) throw new Error("Codex reports no cache writes");
    lines.push({ type: "event_msg", timestamp: at(), payload: { type: "task_started", turn_id: `turn-${ti}` } });
    lines.push({ type: "event_msg", timestamp: at(), payload: { type: "user_message", message: turn.prompt } });
    (turn.tools ?? []).forEach((tool, k) => {
      const call_id = `${s.sessionId}-c${ti}-${k}`;
      lines.push({ type: "response_item", timestamp: at(), payload: { type: "function_call", name: tool.name, arguments: JSON.stringify(tool.input), call_id } });
      lines.push({ type: "response_item", timestamp: at(), payload: { type: "function_call_output", call_id, output: `Process exited with code ${tool.isError ? 1 : 0}` } });
    });
    const last = { input_tokens: turn.tokens.input + turn.tokens.cacheRead, cached_input_tokens: turn.tokens.cacheRead, output_tokens: turn.tokens.output, reasoning_output_tokens: 0, total_tokens: 0 };
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += last[k];
    lines.push({ type: "event_msg", timestamp: at(), payload: { type: "token_count", info: { total_token_usage: { ...total }, last_token_usage: last, model_context_window: 200000 } } });
    if (turn.end !== false) lines.push({ type: "event_msg", timestamp: at(), payload: { type: "task_complete", turn_id: `turn-${ti}` } });
  });
  const path = join(d, `rollout-${s.sessionId}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

function usage(t: Tokens) {
  return { input_tokens: t.input, output_tokens: t.output, cache_read_input_tokens: t.cacheRead, cache_creation_input_tokens: t.cacheWrite };
}

function zero(): Tokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
