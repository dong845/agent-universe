// The task diary (spec 4): one task's full record as steps, per agent, with its tokens, outcome and
// rework. Pure: the same events always give the same diary.
import type { AgentTownEvent, Faction, Role, Tokens } from "../../../schema/src/event.ts";
import { addTokens, zeroTokens } from "../../../schema/src/event.ts";
import { detectRework } from "../../../schema/src/insights.ts";

export interface DiaryStep {
  ts: number;
  agentId: string;
  role?: Role;
  tool: string;
  target?: string;
  status: "ok" | "error" | "denied" | "running";
  /**
   * tokens of the model call that read this step's result (the agent's next call). Several tool
   * calls read by one model call: the call is credited once, to the last of them; the others are
   * null. 0: no call followed.
   */
  tokens: number | null;
}

export interface DiaryAgent {
  agentId: string;
  agentType?: string;
  agentTask?: string;
  steps: DiaryStep[];
  tokens: number;
}

export interface Diary {
  taskId: string;
  title?: string;
  /** a system-opened turn: the human request it continues, and what opened it */
  continues?: string;
  triggerBy?: AgentTownEvent["triggerBy"];
  faction: Faction;
  projectId: string;
  projectBy?: AgentTownEvent["projectBy"];
  models: string[];
  start: number;
  end: number | null;
  outcome: "ok" | "error" | "unknown" | "running";
  tokens: Tokens;
  subagentTokens: number;
  main: DiaryStep[];
  agents: DiaryAgent[];
  rework: { file: string; edits: number }[];
  replayable: boolean;
}

const sum = (t: Tokens) => t.input + t.output + t.cacheRead + t.cacheWrite;

export function diaryOf(input: AgentTownEvent[], taskId: string, live: boolean): Diary {
  const events = input.filter((e) => e.taskId === taskId).sort((a, b) => a.ts - b.ts);
  if (!events.length) throw new Error(`no events for task ${taskId}`);
  const startEv = events.find((e) => e.kind === "task_start");
  const endEv = events.find((e) => e.kind === "task_end");
  const ends = new Map(events.filter((e) => e.kind === "tool_end" && e.toolUseId).map((e) => [e.toolUseId!, e]));

  let tokens = zeroTokens();
  let sub = 0;
  const models: string[] = [];
  const calls = events.filter((e) => e.kind === "model_call" && e.tokens);
  for (const c of calls) {
    tokens = addTokens(tokens, c.tokens!);
    if (c.agentId !== "main") sub += sum(c.tokens!);
    if (c.model && !models.includes(c.model)) models.push(c.model);
  }

  const toolStarts = events.filter((e) => e.kind === "tool_start");
  // which step each model call is credited to: the latest-finishing step it was the next call after
  const reader = new Map<AgentTownEvent, AgentTownEvent>(); // step → the call that read it
  const credited = new Map<AgentTownEvent, AgentTownEvent>(); // call → its one credited step
  for (const e of toolStarts) {
    const after = (e.toolUseId ? ends.get(e.toolUseId)?.ts : undefined) ?? e.ts;
    const next = calls.find((c) => c.agentId === e.agentId && c.ts >= after);
    if (!next) continue;
    reader.set(e, next);
    const prev = credited.get(next);
    const prevAfter = prev ? (prev.toolUseId ? ends.get(prev.toolUseId)?.ts : undefined) ?? prev.ts : -Infinity;
    if (after >= prevAfter) credited.set(next, e);
  }
  const stepOf = (e: AgentTownEvent): DiaryStep => {
    const end = e.toolUseId ? ends.get(e.toolUseId) : undefined;
    const next = reader.get(e);
    return {
      ts: e.ts, agentId: e.agentId, role: e.role, tool: e.tool ?? "?", target: e.target, status: end?.status ?? "running",
      tokens: !next ? 0 : credited.get(next) === e ? sum(next.tokens!) : null,
    };
  };
  const main = toolStarts.filter((e) => e.agentId === "main").map(stepOf);

  const agents: DiaryAgent[] = [];
  for (const id of [...new Set(events.filter((e) => e.agentId !== "main").map((e) => e.agentId))]) {
    const spawn = events.find((e) => e.kind === "agent_spawn" && e.agentId === id);
    agents.push({
      agentId: id,
      agentType: spawn?.agentType,
      agentTask: spawn?.agentTask,
      steps: toolStarts.filter((e) => e.agentId === id).map(stepOf),
      tokens: calls.filter((c) => c.agentId === id).reduce((n, c) => n + sum(c.tokens!), 0),
    });
  }

  // rework: the files a cloud formed over, with how many successful edits each got in this task
  const clouds = detectRework(events).clouds.filter((c) => c.file);
  const rework = [...new Set(clouds.map((c) => c.file!))].map((file) => ({
    file,
    edits: toolStarts.filter((e) => e.role === "smith" && e.target === file && ends.get(e.toolUseId ?? "")?.status === "ok").length,
  }));

  const outcome: Diary["outcome"] = endEv ? (endEv.status === "error" ? "error" : "ok") : live ? "running" : "unknown";
  return {
    taskId,
    title: startEv?.title,
    continues: startEv?.continues,
    triggerBy: startEv?.triggerBy,
    faction: events[0].faction,
    projectId: events[0].projectId,
    projectBy: startEv?.projectBy,
    models,
    start: startEv?.ts ?? events[0].ts,
    end: endEv?.ts ?? null,
    outcome,
    tokens,
    subagentTokens: sub,
    main,
    agents,
    rework,
    replayable: toolStarts.length > 0,
  };
}
