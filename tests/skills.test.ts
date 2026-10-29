import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { normSkill, skillsOfEvent } from "../packages/schema/src/skills.ts";
import { skillDescription, skillDirs } from "../packages/server/src/townsFs.ts";

let n = 0;
const call = (p: Partial<AgentTownEvent>): AgentTownEvent => ({ id: `e${n++}`, ts: n, faction: "claude-code", projectId: "/p", sessionId: "s", taskId: "t", agentId: "main", kind: "tool_start", raw: { file: "f", line: 1 }, ...p });

describe("normSkill", () => {
  it("splits a plugin prefix", () => expect(normSkill("superpowers:brainstorming")).toEqual({ key: "brainstorming", display: "brainstorming", plugin: "superpowers" }));
  it("treats _ and - alike, case-insensitively", () => {
    expect(normSkill("music_suggester").key).toBe("music-suggester");
    expect(normSkill("Music-Suggester").key).toBe("music-suggester");
    expect(normSkill("Music_Suggester").display).toBe("Music_Suggester");
  });
});

describe("skillsOfEvent", () => {
  it("reads the Skill tool's target", () => expect(skillsOfEvent(call({ tool: "Skill", target: "superpowers:brainstorming" }))).toEqual(["brainstorming"]));
  it("reads a SKILL.md path in a Codex command", () => expect(skillsOfEvent(call({ faction: "codex", tool: "exec_command", target: "cat ~/.codex/skills/slide-maker/SKILL.md" }))).toEqual(["slide-maker"]));
  it("reads a SKILL.md path from the untruncated files", () =>
    expect(skillsOfEvent(call({ tool: "Read", target: "/a/very/long/…", files: [{ path: "/u/.claude/skills/x_y/SKILL.md", access: "read" }] }))).toEqual(["x-y"]));
  it("ignores hidden skill folders", () => expect(skillsOfEvent(call({ tool: "exec_command", target: "cat ~/.codex/skills/.system/imagegen/SKILL.md" }))).toEqual([]));
  it("finds nothing in an ordinary command or a non-tool event", () => {
    expect(skillsOfEvent(call({ tool: "Bash", target: "ls skills/" }))).toEqual([]);
    expect(skillsOfEvent(call({ kind: "model_call", tool: "Skill", target: "x" }))).toEqual([]);
  });
});

describe("skill descriptions (local files)", () => {
  const h = mkdtempSync(join(tmpdir(), "at-skills-"));
  mkdirSync(join(h, ".claude/skills/music_suggester"), { recursive: true });
  writeFileSync(join(h, ".claude/skills/music_suggester/SKILL.md"), '---\nname: music\ndescription: "Suggests songs for a mood. Use when asked."\n---\nbody\n');
  mkdirSync(join(h, ".codex/skills/plain"), { recursive: true });
  writeFileSync(join(h, ".codex/skills/plain/SKILL.md"), "---\ndescription: Builds things\nname: plain\n---\n");

  it("takes the first sentence of the description", () => expect(skillDescription(skillDirs(h, "music-suggester"))).toBe("Suggests songs for a mood."));
  it("reads a plain scalar", () => expect(skillDescription(skillDirs(h, "plain"))).toBe("Builds things"));
  it("gives nothing when no SKILL.md exists", () => expect(skillDescription(skillDirs(h, "absent"))).toBeUndefined());
});

import { loadWorldConfig } from "../packages/server/src/townsFs.ts";
import { DEFAULT_WORLD_CONFIG } from "../packages/schema/src/worldConfig.ts";

describe("loadWorldConfig", () => {
  const d = mkdtempSync(join(tmpdir(), "at-cfg-"));
  it("the shipped file equals the defaults", () => expect(loadWorldConfig()).toEqual(DEFAULT_WORLD_CONFIG));
  it("merges a partial file and keeps a missing file at the defaults", () => {
    writeFileSync(join(d, "w.json"), JSON.stringify({ investigationCalls: 5, productExt: { docs: ["adoc"] } }));
    const c = loadWorldConfig(join(d, "w.json") as unknown as URL);
    expect(c.investigationCalls).toBe(5);
    expect(c.productExt.docs).toEqual(["adoc"]);
    expect(c.productExt.code).toEqual(DEFAULT_WORLD_CONFIG.productExt.code);
    expect(loadWorldConfig(join(d, "none.json") as unknown as URL)).toEqual(DEFAULT_WORLD_CONFIG);
  });
  it("refuses a wrong type loudly", () => {
    writeFileSync(join(d, "bad.json"), JSON.stringify({ landmarkTiers: [1, 2] }));
    expect(() => loadWorldConfig(join(d, "bad.json") as unknown as URL)).toThrow(/landmarkTiers/);
  });
});
