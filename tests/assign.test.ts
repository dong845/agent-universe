import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignProjects, TEMP_PROJECT } from "../packages/server/src/assign.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";

function world() {
  const h = realpathSync(mkdtempSync(join(tmpdir(), "at-assign-")));
  for (const d of ["code/repoA/.git", "code/repoA/src", "code/repoB/.git", "code/tb/.git", ".claude/skills", "Downloads/deck/a", "scratch"]) mkdirSync(join(h, d), { recursive: true });
  symlinkSync(join(h, "code/tb"), join(h, ".claude/skills/tb"));
  return { h, opts: { home: h, tempRoots: [join(h, "scratch")] } };
}

let n = 0;
function ev(p: Partial<AgentTownEvent>): AgentTownEvent {
  return { id: `e${n++}`, ts: n, faction: "claude-code", projectId: "/nowhere", sessionId: "s", taskId: "t1", agentId: "main", kind: "tool_start", raw: { file: "f", line: 1 }, ...p };
}
const task = (cwd: string, tools: Partial<AgentTownEvent>[], taskId = "t1", faction: AgentTownEvent["faction"] = "claude-code") => [
  ev({ kind: "task_start", projectId: cwd, taskId, faction }),
  ...tools.map((t) => ev({ projectId: cwd, taskId, faction, ...t })),
  ev({ kind: "task_end", projectId: cwd, taskId, faction }),
];
const startOf = (evs: AgentTownEvent[], taskId = "t1") => evs.find((e) => e.kind === "task_start" && e.taskId === taskId)!;

describe("assignProjects", () => {
  it("puts a task started in home into the repo whose files it edited", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Edit", target: join(h, "code/repoA/src/x.ts") }]);
    assignProjects(evs, opts);
    expect(new Set(evs.map((e) => e.projectId))).toEqual(new Set([join(h, "code/repoA")]));
    expect(startOf(evs).projectBy).toBe("files");
  });

  it("takes the repo with the most touches", () => {
    const { h, opts } = world();
    const a = join(h, "code/repoA/src/x.ts");
    const evs = task(h, [{ tool: "Read", target: a }, { tool: "Read", target: a }, { tool: "Edit", target: a }, { tool: "Edit", target: join(h, "code/repoB/y.ts") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoA"));
  });

  it("sends temp-directory work, by file or by cwd, to the one temp site", () => {
    const { h, opts } = world();
    const byFile = task(h, [{ tool: "Write", target: join(h, "scratch/run1/out.md") }], "t1");
    const byCwd = task(join(h, "scratch/run2"), [], "t2");
    assignProjects([...byFile, ...byCwd], opts);
    expect(startOf(byFile).projectId).toBe(TEMP_PROJECT);
    expect(startOf(byCwd, "t2").projectId).toBe(TEMP_PROJECT);
  });

  it("uses the second level under home when no repo holds the file", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Write", target: join(h, "Downloads/deck/a/b.md") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "Downloads/deck"));
  });

  it("falls back to the cwd's repo when the task touched no files", () => {
    const { h, opts } = world();
    const evs = task(join(h, "code/repoA/src"), [{ tool: "Bash", target: "ls" }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoA"));
    expect(startOf(evs).projectBy).toBe("cwd");
  });

  it("moves the task's subagent events with it; events outside tasks keep the cwd", () => {
    const { h, opts } = world();
    const evs = [...task(h, [{ tool: "Edit", target: join(h, "code/repoA/a.ts") }, { kind: "model_call", agentId: "sub1" }]), ev({ kind: "model_call", taskId: null, projectId: join(h, "code/repoB") })];
    assignProjects(evs, opts);
    expect(evs.find((e) => e.agentId === "sub1")!.projectId).toBe(join(h, "code/repoA"));
    expect(evs.at(-1)!.projectId).toBe(join(h, "code/repoB"));
  });

  it("reads a clipped path by its directory", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Read", target: join(h, "code/repoA/src/averyveryl…") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoA"));
  });

  it("reads a Codex apply_patch header, relative to the cwd", () => {
    const { h, opts } = world();
    const evs = task(join(h, "code/repoB"), [{ tool: "apply_patch", target: "*** Begin Patch\n*** Update File: src/z.ts\n@@" }], "t1", "codex");
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoB"));
    expect(startOf(evs).projectBy).toBe("files");
  });

  it("follows a symlinked skill folder to its real repo", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Edit", target: join(h, ".claude/skills/tb/SKILL.md") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/tb"));
  });

  it("infers the town from a path in a shell command, and says so", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Bash", target: `cd ${join(h, "code/repoA")} && npm test` }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoA"));
    expect(startOf(evs).projectBy).toBe("inferred");
  });

  it("lets an exact file path outvote any number of inferred ones", () => {
    const { h, opts } = world();
    const cd = { tool: "Bash", target: `cd ${join(h, "code/repoA")} && ls` };
    const evs = task(h, [cd, cd, cd, { tool: "Edit", target: join(h, "code/repoB/y.ts") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoB"));
    expect(startOf(evs).projectBy).toBe("files");
  });

  it("ignores shell paths outside home, missing paths, and ~ itself", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Bash", target: "cat /usr/bin/env" }, { tool: "exec_command", target: `ls ${join(h, "nope/x")}` }, { tool: "Bash", target: "cd ~ && ls" }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(h);
    expect(startOf(evs).projectBy).toBe("cwd");
  });

  it("expands ~ in shell paths", () => {
    const { h, opts } = world();
    writeFileSync(join(h, "code/repoB/README.md"), "x");
    const evs = task(h, [{ tool: "exec_command", target: "sed -n 1,20p ~/code/repoB/README.md" }], "t1", "codex");
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoB"));
  });

  it("treats temp files as by-products: any other town, even inferred, outvotes them", () => {
    const { h, opts } = world();
    const tmp = { tool: "Write", target: join(h, "scratch/shot.png") };
    const evs = task(h, [tmp, tmp, tmp, { tool: "Bash", target: `cd ${join(h, "code/repoA")} && git status` }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoA"));
    expect(startOf(evs).projectBy).toBe("inferred");
  });
});
