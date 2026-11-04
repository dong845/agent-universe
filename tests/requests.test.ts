import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { requestIdsOf } from "../packages/schema/src/requests.ts";

let n = 0;
function start(taskId: string, ts: number, trigger: "human" | "system", sessionId = "s1", faction: AgentTownEvent["faction"] = "claude-code"): AgentTownEvent {
  return { id: `e${n++}`, ts, faction, projectId: "/p", sessionId, taskId, agentId: "main", kind: "task_start", trigger, raw: { file: "f", line: 1 } };
}

describe("requestIdsOf", () => {
  it("folds a system turn into the human turn before it", () => {
    const m = requestIdsOf([start("h1", 1, "human"), start("x1", 2, "system")]);
    expect(m.get("x1")).toBe("h1");
    expect(m.get("h1")).toBe("h1");
  });

  it("joins the latest human turn, not the first", () => {
    const m = requestIdsOf([start("h1", 1, "human"), start("h2", 5, "human"), start("x1", 6, "system")]);
    expect(m.get("x1")).toBe("h2");
  });

  it("a system turn first in its session is its own request", () => {
    const m = requestIdsOf([start("x0", 1, "system"), start("h1", 2, "human")]);
    expect(m.get("x0")).toBe("x0");
  });

  it("never joins across sessions or factions", () => {
    const m = requestIdsOf([start("h1", 1, "human", "s1", "claude-code"), start("x1", 2, "system", "s1", "codex"), start("x2", 3, "system", "s2")]);
    expect(m.get("x1")).toBe("x1");
    expect(m.get("x2")).toBe("x2");
  });

  it("ignores array order", () => {
    const evs = [start("h1", 1, "human"), start("x1", 2, "system"), start("h2", 3, "human"), start("x2", 4, "system")];
    expect(requestIdsOf([...evs].reverse())).toEqual(requestIdsOf(evs));
    expect(requestIdsOf(evs).get("x2")).toBe("h2");
  });

  it("a task without a trigger counts as human", () => {
    const e = start("h1", 1, "human");
    delete e.trigger;
    expect(requestIdsOf([e, start("x1", 2, "system")]).get("x1")).toBe("h1");
  });
});

import { buildRequests } from "../packages/schema/src/requests.ts";
import { DEFAULT_WORLD_CONFIG } from "../packages/schema/src/worldConfig.ts";

describe("buildRequests", () => {
  let k = 0;
  const base = (taskId: string, ts: number): Omit<AgentTownEvent, "kind"> => ({ id: `b${k++}`, ts, faction: "claude-code", projectId: "/repo", sessionId: "s1", taskId, agentId: "main", raw: { file: "f", line: 1 } });
  /** one turn: start, the given tool calls, a model call, an optional end */
  const turn = (taskId: string, t0: number, tools: Partial<AgentTownEvent>[], o: { trigger?: "human" | "system"; end?: "ok" | "error" | null; tokens?: number; title?: string } = {}): AgentTownEvent[] => [
    { ...base(taskId, t0), kind: "task_start", trigger: o.trigger ?? "human", title: o.title },
    ...tools.map((t, i) => ({ ...base(taskId, t0 + 1 + i), kind: "tool_start" as const, tool: "Bash", ...t })),
    { ...base(taskId, t0 + 100), kind: "model_call", tokens: { input: o.tokens ?? 10, output: 1, cacheRead: 2, cacheWrite: 3 } },
    ...(o.end === null ? [] : [{ ...base(taskId, t0 + 200), kind: "task_end" as const, status: o.end ?? "ok" }]),
  ];
  const edit = (path: string): Partial<AgentTownEvent> => ({ tool: "Edit", files: [{ path, access: "edit" }] });
  const rows = (evs: AgentTownEvent[]) => buildRequests(evs, requestIdsOf(evs), DEFAULT_WORLD_CONFIG);
  const one = (evs: AgentTownEvent[]) => rows(evs)[0];

  it("classifies by edits, then by the number of calls", () => {
    expect(one(turn("a", 0, Array(19).fill({ tool: "Bash" }))).class).toBe("chat");
    expect(one(turn("a", 0, Array(20).fill({ tool: "Bash" }))).class).toBe("investigation");
    expect(one(turn("a", 0, [])).class).toBe("empty");
    expect(one(turn("a", 0, [edit("/repo/a.ts")])).class).toBe("produced");
  });

  it("an image generation alone is a produced image", () => {
    const r = one(turn("a", 0, [{ tool: "image_generation_call" }]));
    expect([r.class, r.productKind]).toEqual(["produced", "image"]);
  });

  it("votes the product kind by edited files, ties in table order", () => {
    expect(one(turn("a", 0, [edit("/repo/a.md"), edit("/repo/b.md"), edit("/repo/c.ts")])).productKind).toBe("docs");
    expect(one(turn("a", 0, [edit("/repo/a.md"), edit("/repo/c.ts")])).productKind).toBe("code");
    expect(one(turn("a", 0, [edit("/repo/deck/out.html")])).productKind).toBe("slides");
    expect(one(turn("a", 0, [edit("/repo/a/remotion/Comp.tsx")])).productKind).toBe("video");
    expect(one(turn("a", 0, [edit("/repo/Makefile")])).productKind).toBe("code");
    expect(one(turn("a", 0, [edit("/repo/app.lock")])).productKind).toBe("data");
    expect(one(turn("a", 0, [edit("/repo/d.json")])).productKind).toBe("data");
    expect(one(turn("a", 0, [{ tool: "Bash" }])).productKind).toBeNull();
  });

  it("names the most-edited top directory, '.' for a root file, null outside a real folder", () => {
    expect(one(turn("a", 0, [edit("/repo/src/a.ts"), edit("/repo/src/b.ts"), edit("/repo/docs/c.md")])).topDir).toBe("src");
    expect(one(turn("a", 0, [edit("/repo/a.ts")])).topDir).toBe(".");
    const out = turn("a", 0, [edit("/elsewhere/a.ts")]).map((e) => ({ ...e, projectId: "野外营地" }));
    expect(one(out).topDir).toBeNull();
  });

  it("folds a system turn's calls, tokens and outcome into the request", () => {
    const evs = [...turn("h", 0, [{ tool: "Bash" }], { tokens: 10, title: "Do it" }), ...turn("x", 1000, [edit("/repo/a.ts")], { trigger: "system", tokens: 5, end: "error" })];
    const [r] = rows(evs);
    expect(rows(evs)).toHaveLength(1);
    expect(r).toMatchObject({ requestId: "h", class: "produced", calls: 2, turns: 2, ok: false, title: "Do it", taskIds: ["h", "x"], startTs: 0, endTs: 1200 });
    expect(r.tokens).toEqual({ input: 15, output: 2, cacheRead: 4, cacheWrite: 6 });
  });

  it("ok is null while any turn has no end", () => {
    expect(one(turn("a", 0, [], { end: null })).ok).toBeNull();
    expect(one(turn("a", 0, [])).ok).toBe(true);
  });

  it("lists the skills used, in order of first use", () => {
    const r = one(turn("a", 0, [{ tool: "Skill", target: "beta" }, { tool: "Read", files: [{ path: "/u/skills/alpha/SKILL.md", access: "read" }] }, { tool: "Skill", target: "beta" }]));
    expect(r.skills).toEqual(["beta", "alpha"]);
  });

  it("counts failed calls and spawned agents", () => {
    const evs = turn("a", 0, [{ tool: "Bash" }]);
    evs.push({ ...base("a", 50), kind: "tool_end", status: "error" }, { ...base("a", 51), kind: "tool_end", status: "denied" }, { ...base("a", 52), kind: "agent_spawn" });
    expect(one(evs)).toMatchObject({ fails: 2, spawns: 1 });
  });
});

describe("request titles that say nothing (owner 2026-10-29)", () => {
  let k = 0;
  const start = (taskId: string, ts: number, title: string, sessionId = "s1", trigger: "human" | "system" = "human"): AgentTownEvent => ({ id: `t${k++}`, ts, faction: "codex", projectId: "/p", sessionId, taskId, agentId: "main", kind: "task_start", trigger, title, raw: { file: "f", line: 1 } });
  const rows = (evs: AgentTownEvent[]) => buildRequests(evs, requestIdsOf(evs), DEFAULT_WORLD_CONFIG);

  it("a bare reply continues the session's last request that said something; the words stay as `asked`", () => {
    const r = rows([start("a", 1, "把登录页改成深色"), start("b", 2, "可以"), start("c", 3, "继续。"), start("d", 4, "ok")]);
    expect(r.map((x) => x.title)).toEqual(["把登录页改成深色", "接续：把登录页改成深色", "接续：把登录页改成深色", "接续：把登录页改成深色"]);
    expect(r[1].asked).toBe("可以");
    expect(r[0].asked).toBeUndefined();
  });

  it("keeps a short reply when nothing before it said anything, and never reaches into another session", () => {
    const r = rows([start("a", 1, "继续"), start("b", 2, "修好测试", "s2"), start("c", 3, "好的", "s3")]);
    expect(r.map((x) => x.title)).toEqual(["继续", "修好测试", "好的"]);
  });

  it("an option pick (1, A) and a short 继续… are bare too; push is not", () => {
    const r = rows([start("a", 1, "做两个方案"), start("b", 2, "B"), start("c", 3, "2"), start("d", 4, "继续优化"), start("e", 5, "push")]);
    expect(r.map((x) => x.title)).toEqual(["做两个方案", "接续：做两个方案", "接续：做两个方案", "接续：做两个方案", "push"]);
  });

  it("a short but meaningful request keeps its own title", () => {
    const r = rows([start("a", 1, "写文档"), start("b", 2, "修 bug"), start("c", 3, "Fix CI")]);
    expect(r.map((x) => x.title)).toEqual(["写文档", "修 bug", "Fix CI"]);
  });
});

describe("request rows carry the session folder for the resume command (attention task 6)", () => {
  it("cwd from the opening task_start", () => {
    const base = { faction: "claude-code" as const, projectId: "/p", sessionId: "s", agentId: "main" };
    const evs: AgentTownEvent[] = [
      { ...base, id: "t1", ts: 1, taskId: "t1", kind: "task_start", trigger: "human", title: "go", cwd: "/synthetic/folder" },
      { ...base, id: "e1", ts: 2, taskId: "t1", kind: "task_end" },
    ];
    expect(buildRequests(evs, requestIdsOf(evs), DEFAULT_WORLD_CONFIG)[0].cwd).toBe("/synthetic/folder");
  });
});

describe("per-request work and a sentence for untitled requests (spec 2026-11-03 B1/B3)", () => {
  const base = { faction: "codex" as const, projectId: "/synthetic/p", sessionId: "s", agentId: "main" };
  let n = 0;
  const ev = (taskId: string, kind: AgentTownEvent["kind"], extra: Partial<AgentTownEvent> = {}): AgentTownEvent => ({ ...base, id: `w${n++}`, ts: n, taskId, kind, ...extra });
  const evs: AgentTownEvent[] = [
    ev("t1", "task_start", { trigger: "human" }), // no title: Codex often has none
    ev("t1", "tool_start", { role: "smith", tool: "apply_patch", files: [{ path: "/synthetic/p/src/a.ts", access: "edit" }, { path: "/synthetic/p/src/b.ts", access: "edit" }] }),
    ev("t1", "tool_start", { role: "smith", tool: "apply_patch", files: [{ path: "/synthetic/p/docs/c.md", access: "edit" }] }),
    ev("t1", "tool_start", { role: "engineer", tool: "exec_command", target: "pytest -q" }),
    ev("t1", "agent_spawn", { agentId: "child" }),
    ev("t1", "compaction"),
    ev("t1", "task_end"),
    ev("t2", "task_start", { trigger: "human" }),
    ev("t2", "tool_start", { role: "engineer", tool: "exec_command", target: "git status" }),
    ev("t2", "task_end"),
    ev("t3", "task_start", { trigger: "human", title: "有标题的请求" }),
    ev("t3", "tool_start", { role: "scout", tool: "Read", files: [{ path: "/synthetic/p/x.ts", access: "read" }] }),
    ev("t3", "task_end"),
  ];
  const rows = buildRequests(evs, requestIdsOf(evs), DEFAULT_WORLD_CONFIG);
  const byId = new Map(rows.map((r) => [r.requestId, r]));
  it("counts each request's calls per kind of work, like a town's", () => {
    expect(byId.get("t1")!.work).toEqual({ smith: 2, engineer: 1, spawn: 1, compaction: 1 });
    expect(byId.get("t2")!.work).toEqual({ engineer: 1 });
  });
  it("an untitled request gets a sentence of what it did, from its own events", () => {
    expect(byId.get("t1")!.gist).toBe("改了 3 个文件：a.ts、b.ts 等");
    expect(byId.get("t2")!.gist).toBe("跑命令：git status");
    expect(byId.get("t3")!.gist).toBeUndefined(); // it has a title
  });
});
