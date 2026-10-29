import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import type { RequestRow } from "../packages/schema/src/payload.ts";
import { pickTheme, type ThemesConfig } from "../packages/schema/src/themes.ts";
import { buildTowns, CAPITAL, OUTPOST } from "../packages/schema/src/towns.ts";
import { guildSkillsOf, readOverrides } from "../packages/server/src/townsFs.ts";

const themes = JSON.parse(readFileSync(new URL("../config/themes.json", import.meta.url), "utf8")) as ThemesConfig;

describe("pickTheme", () => {
  const t = (...texts: string[]) => pickTheme(texts, themes);
  it("reads the town name", () => {
    expect(t("slides_maker")).toBe("publishing");
    expect(t("topic-to-video")).toBe("film");
    expect(t("music_suggester")).toBe("music");
    expect(t("agent-town")).toBe("toyworks");
    expect(t("marketfit-job-lens")).toBe("talent");
    expect(t("investment_agent")).toBe("exchange");
  });
  it("falls back to later texts, in order, then the default", () => {
    expect(t("lifeos")).toBe("stargazer");
    expect(t("qzx", "", "daily fortune and destiny")).toBe("stargazer");
    expect(t("qzx")).toBe("craftsmen");
  });
  it("lets the name win over a description that mentions another theme", () => expect(t("topic-to-video", "", "turn a slide deck into a video")).toBe("film"));
  it("does not read a 3-letter keyword inside a longer word", () => expect(t("docker-tools")).toBe("craftsmen"));
});

let n = 0;
const ev = (p: Partial<AgentTownEvent>): AgentTownEvent => ({ id: `e${n++}`, ts: n, faction: "claude-code", projectId: "/c/app", sessionId: "s", taskId: "r1", agentId: "main", kind: "tool_start", raw: { file: "f", line: 1 }, ...p });
const req = (p: Partial<RequestRow>): RequestRow => ({ requestId: `r${n++}`, faction: "claude-code", projectId: "/c/app", sessionId: "s", startTs: 0, endTs: 1, ok: true, class: "produced", productKind: "code", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, calls: 1, fails: 0, spawns: 0, skills: [], topDir: null, turns: 1, taskIds: [], ...p });
const opts = (o: Partial<Parameters<typeof buildTowns>[2]> = {}) => ({ themes, overrides: {}, guildSkillsOf: () => [], describe: () => undefined, ...o });

describe("buildTowns", () => {
  it("one town per faction and folder, with counts per class", () => {
    const towns = buildTowns([req({}), req({ class: "chat" }), req({ class: "empty" }), req({ faction: "codex" })], [], opts());
    expect(towns.map((t) => t.key).sort()).toEqual(["claude-code|/c/app", "codex|/c/app"]);
    expect(towns.find((t) => t.faction === "claude-code")!.counts).toEqual({ produced: 1, investigation: 0, chat: 1, empty: 1 });
  });

  it("names the capital and the outpost, with fixed themes", () => {
    const towns = buildTowns([req({ projectId: CAPITAL }), req({ projectId: OUTPOST })], [], opts());
    expect(towns.map((t) => [t.name, t.kind, t.theme]).sort()).toEqual([["都城", "capital", "capital"], ["野外营地", "outpost", "outpost"]]);
  });

  it("a skill folder is a guild named after its skill; a repo holding skills is a guild under its own name", () => {
    const guild = (dir: string) => (dir === "/h/.claude/skills/alpha" ? ["alpha"] : dir === "/c/slides_kit" ? ["beta"] : []);
    const towns = buildTowns([req({ projectId: "/h/.claude/skills/alpha" }), req({ projectId: "/c/slides_kit" })], [], opts({ guildSkillsOf: guild }));
    const a = towns.find((t) => t.projectId.endsWith("alpha"))!;
    const b = towns.find((t) => t.projectId.endsWith("slides_kit"))!;
    expect([a.name, a.kind, a.guildOf]).toEqual(["alpha 公会", "guild", ["alpha"]]);
    expect([b.name, b.kind, b.guildOf, b.skillNote, b.theme]).toEqual(["slides_kit", "guild", ["beta"], "beta 公会", "publishing"]);
  });

  it("a guild's theme can come from its skill's description", () => {
    const [t] = buildTowns([req({ projectId: "/h/skills/qzx" })], [], opts({ guildSkillsOf: () => ["qzx"], describe: () => "A destiny chart reader." }));
    expect(t.theme).toBe("stargazer");
  });

  it("tells apart two towns with one name", () => {
    const names = buildTowns([req({ projectId: "/a/app" }), req({ projectId: "/b/app" })], [], opts()).map((t) => t.name).sort();
    expect(names).toEqual(["a/app", "b/app"]);
  });

  it("a local override names a known theme; an unknown one is ignored", () => {
    const [a] = buildTowns([req({})], [], opts({ overrides: { "claude-code|/c/app": "harbor" } }));
    const [b] = buildTowns([req({})], [], opts({ overrides: { "claude-code|/c/app": "nope" } }));
    expect([a.theme, b.theme]).toEqual(["harbor", "craftsmen"]);
  });

  it("counts kinds of work and the last edit from the events", () => {
    const evs = [ev({ role: "scout" }), ev({ role: "scout" }), ev({ role: "smith", ts: 500, files: [{ path: "/c/app/a.ts", access: "edit" }] }), ev({ kind: "agent_spawn" }), ev({ kind: "compaction" }), ev({ role: "smith", projectId: "/other", ts: 900, files: [{ path: "/other/x", access: "edit" }] })];
    const [t] = buildTowns([req({})], evs, opts());
    expect(t.workCounts).toEqual({ scout: 2, smith: 1, spawn: 1, compaction: 1 });
    expect(t.lastEditTs).toBe(500);
  });
});

describe("guildSkillsOf and readOverrides (local files)", () => {
  const h = mkdtempSync(join(tmpdir(), "at-towns-"));
  for (const d of ["home/.claude/skills/music_suggester", "repo/skills/beta", "repo/skills/.hidden", "solo", "plain"]) mkdirSync(join(h, d), { recursive: true });
  writeFileSync(join(h, "repo/skills/beta/SKILL.md"), "---\nname: beta\n---\n");
  writeFileSync(join(h, "repo/skills/.hidden/SKILL.md"), "---\nname: hid\n---\n");
  writeFileSync(join(h, "solo/SKILL.md"), "---\nname: Solo_Skill\ndescription: x\n---\n");

  it("a folder named under skills/ is that skill", () => expect(guildSkillsOf(join(h, "home/.claude/skills/music_suggester"))).toEqual(["music-suggester"]));
  it("a repo's skills/*/SKILL.md, hidden ones skipped", () => expect(guildSkillsOf(join(h, "repo"))).toEqual(["beta"]));
  it("a folder that is itself a skill, by its frontmatter name", () => expect(guildSkillsOf(join(h, "solo"))).toEqual(["solo-skill"]));
  it("an ordinary folder, the capital and the outpost hold none", () => {
    expect(guildSkillsOf(join(h, "plain"))).toEqual([]);
    expect(guildSkillsOf(CAPITAL)).toEqual([]);
  });
  it("overrides: missing or garbled files give none, non-string values are dropped", () => {
    writeFileSync(join(h, "o.json"), JSON.stringify({ "claude-code|/c/app": "film", bad: 3 }));
    writeFileSync(join(h, "g.json"), "{nope");
    expect(readOverrides(join(h, "o.json"))).toEqual({ "claude-code|/c/app": "film" });
    expect(readOverrides(join(h, "g.json"))).toEqual({});
    expect(readOverrides(join(h, "none.json"))).toEqual({});
  });
});
