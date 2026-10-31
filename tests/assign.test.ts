import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignProjects, CAPITAL, OUTPOST, TEMP_PROJECT } from "../packages/server/src/assign.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";

function world() {
  const h = realpathSync(mkdtempSync(join(tmpdir(), "at-assign-")));
  for (const d of ["code/repoA/.git/worktrees/w1", "code/repoA/src", "code/repoA/.claude/worktrees/w1/src", "code/repoB/.git", "code/tb/.git", ".claude/skills", "x/skills/alpha", ".codex/skills/.system/s", ".codex/generated_images", "Documents/proj/src", "Documents/loose/sub", "Downloads/deck/a", "scratch", "work/app/lib"]) mkdirSync(join(h, d), { recursive: true });
  symlinkSync(join(h, "code/tb"), join(h, ".claude/skills/tb"));
  writeFileSync(join(h, "x/skills/alpha/SKILL.md"), "---\nname: alpha\n---\n");
  writeFileSync(join(h, "code/repoA/.claude/worktrees/w1/.git"), `gitdir: ${join(h, "code/repoA/.git/worktrees/w1")}\n`);
  writeFileSync(join(h, "Documents/proj/package.json"), "{}");
  return { h, opts: { home: h, tempRoots: [join(h, "scratch")], toolRoots: [join(h, ".claude"), join(h, ".codex"), join(h, ".agents")] } };
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

  it("sends unmarked folders outside any repo to the outpost", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Write", target: join(h, "Downloads/deck/a/b.md") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(OUTPOST);
  });

  it("a plain skill dir is its own guild town", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Edit", target: join(h, "x/skills/alpha/SKILL.md") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "x/skills/alpha"));
  });

  it("a worktree's files count for the main repo", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Edit", target: join(h, "code/repoA/.claude/worktrees/w1/src/a.ts") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoA"));
  });

  it("a hidden skill dir under a tool root goes to the capital, as do the tool's own folders", () => {
    const { h, opts } = world();
    const a = task(h, [{ tool: "Edit", target: join(h, ".codex/skills/.system/s/SKILL.md") }], "t1", "codex");
    const b = task(h, [{ tool: "Write", target: join(h, ".codex/generated_images/i.png") }], "t2", "codex");
    assignProjects([...a, ...b], opts);
    expect(startOf(a).projectId).toBe(CAPITAL);
    expect(startOf(b, "t2").projectId).toBe(CAPITAL);
  });

  it("a folder with a project marker is a town", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Edit", target: join(h, "Documents/proj/src/a.ts") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "Documents/proj"));
  });

  it("an unmarked folder the session started in, and edited under, is a town; a loose folder is not", () => {
    const { h, opts } = world();
    const a = task(join(h, "work/app"), [{ tool: "Edit", target: join(h, "work/app/lib/x.py") }], "t1");
    const b = task(join(h, "Documents"), [{ tool: "Edit", target: join(h, "Documents/loose/sub/y.md") }], "t2");
    assignProjects([...a, ...b], opts);
    expect(startOf(a).projectId).toBe(join(h, "work/app"));
    expect(startOf(b, "t2").projectId).toBe(OUTPOST);
  });

  it("a request with no file votes started in home goes to the outpost", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "Bash", target: "echo hi" }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(OUTPOST);
  });

  it("every turn of a request lands in the same town", () => {
    const { h, opts } = world();
    const human = task(h, [{ tool: "Edit", target: join(h, "code/repoA/a.ts") }], "h1");
    const cont = task(h, [{ tool: "Edit", target: join(h, "code/repoB/b.ts") }, { tool: "Edit", target: join(h, "code/repoB/c.ts") }], "x1");
    startOf(cont, "x1").trigger = "system";
    const evs = [...human, ...cont];
    assignProjects(evs, opts, new Map([["h1", "h1"], ["x1", "h1"]]));
    expect(new Set(evs.map((e) => e.projectId))).toEqual(new Set([join(h, "code/repoB")]));
  });

  it("files listed on the event outvote a clipped target", () => {
    const { h, opts } = world();
    const evs = task(h, [{ tool: "apply_patch", target: "*** Begin Patch *** Update File: …", files: [{ path: join(h, "code/repoB/z.ts"), access: "edit" }] }], "t1", "codex");
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoB"));
  });

  it("keeps TEMP_PROJECT as the outpost's old name", () => expect(TEMP_PROJECT).toBe(OUTPOST));

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
    expect(startOf(evs).projectId).toBe(OUTPOST);
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

describe("assignProjects, real-data fixes", () => {
  it("never makes a town of a malformed path", () => {
    const { h, opts } = world();
    const bad = join(h, "code/repoA/x.ts") + String.raw`\n@@\n-a\n+ skills/zz/SKILL.md`;
    const evs = task(h, [{ tool: "apply_patch", target: "…", files: [{ path: bad, access: "edit" }] }], "t1", "codex");
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(OUTPOST);
  });

  it("a skill copied into a temp folder is outpost work", () => {
    const { h, opts } = world();
    mkdirSync(join(h, "scratch/up/skills/alpha"), { recursive: true });
    const evs = task(h, [{ tool: "Edit", target: join(h, "scratch/up/skills/alpha/SKILL.md") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(OUTPOST);
  });

  it("every copy of one skill joins the repository that holds it, per faction", () => {
    const { h, opts } = world();
    mkdirSync(join(h, "code/kit/.git"), { recursive: true });
    mkdirSync(join(h, "code/kit/skills/gamma"), { recursive: true });
    writeFileSync(join(h, "code/kit/skills/gamma/SKILL.md"), "---\nname: gamma\n---\n");
    for (const d of [".agents/skills/gamma", "Documents/out/build/skills/gamma"]) {
      mkdirSync(join(h, d), { recursive: true });
      writeFileSync(join(h, d, "SKILL.md"), "---\nname: gamma\n---\n");
    }
    const a = task(h, [{ tool: "Edit", target: join(h, ".agents/skills/gamma/SKILL.md") }], "t1");
    const b = task(h, [{ tool: "Edit", target: join(h, "Documents/out/build/skills/gamma/SKILL.md") }], "t2", "codex");
    const c = task(h, [{ tool: "Edit", target: join(h, "code/kit/skills/gamma/SKILL.md") }], "t3");
    assignProjects([...a, ...b, ...c], opts);
    expect([startOf(a).projectId, startOf(b, "t2").projectId, startOf(c, "t3").projectId]).toEqual([join(h, "code/kit"), join(h, "code/kit"), join(h, "code/kit")]);
  });

  it("copies of a skill no repository holds join one folder: the most used", () => {
    const { h, opts } = world();
    for (const d of [".claude/skills/delta", "Documents/out/skills/delta"]) {
      mkdirSync(join(h, d), { recursive: true });
      writeFileSync(join(h, d, "SKILL.md"), "x");
    }
    const e = (p: string) => ({ tool: "Edit", target: join(h, p) });
    const a = task(h, [e(".claude/skills/delta/SKILL.md"), e(".claude/skills/delta/SKILL.md")], "t1");
    const b = task(h, [e("Documents/out/skills/delta/SKILL.md")], "t2");
    assignProjects([...a, ...b], opts);
    expect(startOf(b, "t2").projectId).toBe(join(h, ".claude/skills/delta"));
  });
});

describe("assignProjects, review fixes", () => {
  it("reading a skill's instructions does not move a request into the skill's guild (I2)", () => {
    const { h, opts } = world();
    const evs = task(join(h, "code/repoB"), [{ tool: "exec_command", target: `sed -n 1,80p ${join(h, "x/skills/alpha/SKILL.md")}` }, { tool: "Read", target: join(h, "x/skills/alpha/SKILL.md"), files: [{ path: join(h, "x/skills/alpha/SKILL.md"), access: "read" }] }, { tool: "exec_command", target: "rg foo src" }], "t1", "codex");
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "code/repoB"));
  });

  it("editing a skill still places the request in its guild", () => {
    const { h, opts } = world();
    const evs = task(join(h, "code/repoB"), [{ tool: "Edit", target: join(h, "x/skills/alpha/SKILL.md") }]);
    assignProjects(evs, opts);
    expect(startOf(evs).projectId).toBe(join(h, "x/skills/alpha"));
  });

  it("a copy of a skill joins a repository that is that skill at its root (I3)", () => {
    const { h, opts } = world();
    mkdirSync(join(h, "code/tbx/.git"), { recursive: true });
    writeFileSync(join(h, "code/tbx/SKILL.md"), "---\nname: tbx\n---\n");
    mkdirSync(join(h, ".agents/skills/tbx"), { recursive: true });
    writeFileSync(join(h, ".agents/skills/tbx/SKILL.md"), "---\nname: tbx\n---\n");
    const a = task(h, [{ tool: "Edit", target: join(h, "code/tbx/SKILL.md") }], "t1");
    const b = task(h, [{ tool: "Edit", target: join(h, ".agents/skills/tbx/SKILL.md") }], "t2");
    assignProjects([...a, ...b], opts);
    expect(startOf(b, "t2").projectId).toBe(join(h, "code/tbx"));
  });
});

describe("assignProjects, output folders", () => {
  it("a run started inside an output folder (assets/generated, .assets, build) counts for the folder that holds it", () => {
    const { h, opts } = world();
    for (const d of ["Downloads/trip-deck/assets/generated", "work/explainer/.assets", "work/site/build", "Downloads/pitch/video", "Downloads/pitch/video_out"]) mkdirSync(join(h, d), { recursive: true });
    const v = task(join(h, "Downloads/pitch/video"), [{ tool: "Write", target: join(h, "Downloads/pitch/video/v.mp4") }], "t4", "codex");
    const vo = task(join(h, "Downloads/pitch/video_out"), [{ tool: "Write", target: join(h, "Downloads/pitch/video_out/v.mp4") }], "t5", "codex");
    assignProjects([...v, ...vo], opts);
    expect([startOf(v, "t4").projectId, startOf(vo, "t5").projectId]).toEqual([join(h, "Downloads/pitch"), join(h, "Downloads/pitch")]);
    const a = task(join(h, "Downloads/trip-deck/assets/generated"), [{ tool: "Write", target: join(h, "Downloads/trip-deck/assets/generated/a.png") }], "t1", "codex");
    const b = task(join(h, "work/explainer/.assets"), [{ tool: "Write", target: join(h, "work/explainer/.assets/b.png") }], "t2", "codex");
    const c = task(join(h, "work/site/build"), [], "t3", "codex");
    assignProjects([...a, ...b, ...c], opts);
    expect(startOf(a).projectId).toBe(join(h, "Downloads/trip-deck"));
    expect(startOf(b, "t2").projectId).toBe(join(h, "work/explainer"));
    expect(startOf(c, "t3").projectId).toBe(join(h, "work/site"));
  });

  it("an output folder directly in a loose folder still goes to the outpost", () => {
    const { h, opts } = world();
    mkdirSync(join(h, "Downloads/assets"), { recursive: true });
    const a = task(join(h, "Downloads/assets"), [{ tool: "Write", target: join(h, "Downloads/assets/x.png") }], "t1", "codex");
    assignProjects(a, opts);
    expect(startOf(a).projectId).toBe(OUTPOST);
  });
});

describe("assignProjects, output folders never swallow a project", () => {
  it("a repository or a project folder whose name looks like an output folder stays its own town", () => {
    const { h, opts } = world();
    mkdirSync(join(h, "code/media/.git"), { recursive: true });
    mkdirSync(join(h, "work/video/src"), { recursive: true });
    const a = task(join(h, "code/media"), [], "t1");
    const b = task(join(h, "work/video"), [{ tool: "Edit", target: join(h, "work/video/src/a.ts") }], "t2");
    assignProjects([...a, ...b], opts);
    expect(startOf(a).projectId).toBe(join(h, "code/media"));
    expect(startOf(b, "t2").projectId).toBe(join(h, "work/video"));
  });
});
