// The unified event every downstream module reads. See docs/decisions.md D1–D7.
// Plain types for now; phase 1 replaces them with a Zod schema of the same shape.

export type Faction = "claude-code" | "codex";

export type EventKind =
  | "task_start"
  | "task_end"
  | "model_call"
  | "tool_start"
  | "tool_end"
  | "agent_spawn"
  | "agent_return"
  | "awaiting_user"
  | "compaction"
  | "error";

export type Role =
  | "commander"
  | "scout"
  | "smith"
  | "engineer"
  | "inspector"
  | "messenger"
  | "diplomat"
  | "scribe"
  | "painter"
  | "operator"
  | "sentry";

export interface ToolFile {
  path: string;
  access: "read" | "edit";
}

/** Additive token counts, except `reasoning`, which is a part of `output` (D3). */
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
}

export interface AgentTownEvent {
  id: string;
  ts: number;
  faction: Faction;
  projectId: string;
  sessionId: string;
  taskId: string | null;
  agentId: string;
  kind: EventKind;
  parentAgentId?: string;
  spawnToolUseId?: string;
  /** How the spawn link was made (D6). */
  spawnLink?: "exact" | "inferred" | "none";
  groupId?: string;
  agentType?: string;
  agentTask?: string;
  tool?: string;
  toolUseId?: string;
  role?: Role;
  target?: string;
  /** tool_start only: every file the call names exactly, untruncated (Claude file tools, Codex patch headers) */
  files?: ToolFile[];
  tokens?: Tokens;
  contextUsed?: number;
  contextMax?: number;
  model?: string;
  status?: "ok" | "error" | "denied";
  durationMs?: number;
  /** A later log line may still replace this event's token values (D3). */
  provisional?: boolean;
  trigger?: "human" | "system";
  /** task_start only: the first line of the task's first user message, ≤ 80 chars (spec 12.5). Shown on this machine only. */
  title?: string;
  /** task_start only: the folder the agent ran in (the log's `cwd`); shown on this machine only, never exported */
  cwd?: string;
  /** task_start only: the permission mode in force at the turn's start (Claude `permission-mode`, Codex `approval_policy`) */
  permissionMode?: string;
  /** task_start, system-triggered only: the title of the session's last human-started task, which this turn continues */
  continues?: string;
  /** task_start, system-triggered only: what opened the turn — a subagent's hand-back, a compaction summary, another meta line */
  triggerBy?: "peer" | "compact" | "meta" | "other";
  /** task_start only: how the task's town was chosen — exact file paths, paths inferred from shell commands, or its cwd */
  projectBy?: "files" | "inferred" | "cwd";
  compaction?: { preTokens?: number; postTokens?: number; trigger?: string };
  /** Where the record came from: file and 1-based line. Never the content. */
  raw: { file: string; line: number };
}

export const TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export function zeroTokens(): Tokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addTokens(into: Tokens, t: Tokens): Tokens {
  for (const k of TOKEN_KEYS) into[k] += t[k];
  if (t.reasoning !== undefined) into.reasoning = (into.reasoning ?? 0) + t.reasoning;
  return into;
}
