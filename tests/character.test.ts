// The character's rules (spec 2026-11-05 A3/A4): which face a pose shows, which prop a subagent carries.
import { describe, expect, it } from "vitest";
import character from "../art/character.json" with { type: "json" };
import type { Role } from "../packages/schema/src/event.ts";
import { FACES, faceOf, PROPS, propOf, ROLE_PROP, workOf } from "../packages/web/src/character/rules.ts";
import { FACTION_COLOR } from "../packages/web/src/galaxy/galaxyData.ts";
import type { Action, Actor, Pose } from "../packages/web/src/orchestrator/timeline.ts";

const f = (pose: Pose, done = false, idleMs = 0) => faceOf({ pose, done, idleMs });

describe("faceOf", () => {
  it("maps each pose as the spec's table says", () => {
    for (const p of ["walk", "carry", "report", "idle", "dispatch"] as Pose[]) expect(f(p)).toBe("normal");
    expect(f("work")).toBe("focus");
    expect(f("think")).toBe("think");
    expect(f("pack")).toBe("think");
    expect(f("raise_hand")).toBe("wide");
    expect(f("shake")).toBe("error");
    expect(f("fall")).toBe("error");
  });
  it("done is happy, except while hurt", () => {
    expect(f("idle", true)).toBe("happy");
    expect(f("work", true)).toBe("happy");
    expect(f("fall", true)).toBe("error");
    expect(f("idle", true, 120000)).toBe("happy");
  });
  it("gets sleepy after a minute of idling", () => {
    expect(f("idle", false, 59999)).toBe("normal");
    expect(f("idle", false, 60000)).toBe("sleepy");
    expect(f("work", false, 600000)).toBe("focus");
  });
});

const act = (outfit: Role, start: number): Action => ({ start, end: start + 1, due: start, from: { x: 0, z: 0 }, to: { x: 0, z: 0 }, pose: "work", outfit, eventId: `e${start}` });
const actor = (kind: Actor["kind"], baseRole: Role, actions: Action[] = []): Actor => ({ id: "a", kind, baseRole, home: { x: 0, z: 0 }, lane: 0, appear: 0, vanish: null, actions, backpack: [] });

describe("propOf", () => {
  it("a main agent carries nothing", () => expect(propOf(actor("commander", "commander", [act("smith", 0)]), 10)).toBeNull());
  it("a typed subagent carries its role's prop", () => expect(propOf(actor("subagent", "scout"), 0)).toBe("magnifier"));
  it("a general subagent carries the prop of the work it did most", () => {
    expect(propOf(actor("subagent", "commander", [act("smith", 1), act("smith", 2), act("scout", 3)]), 10)).toBe("pencil");
  });
  it("ties go to the work it did first", () => {
    expect(propOf(actor("subagent", "commander", [act("scout", 1), act("smith", 2)]), 10)).toBe("magnifier");
  });
  it("only counts work started by now", () => {
    expect(propOf(actor("subagent", "commander", [act("smith", 1), act("scout", 5), act("scout", 6)]), 3)).toBe("pencil");
    expect(propOf(actor("subagent", "commander", [act("smith", 20)]), 3)).toBe("backpack");
  });
  it("dispatching alone is not a kind of work: backpack", () => {
    expect(propOf(actor("subagent", "commander", [act("commander", 1)]), 10)).toBe("backpack");
  });
});

describe("workOf", () => {
  it("is the role behind the prop, so the headphones match it", () => {
    expect(workOf(actor("commander", "commander", [act("smith", 0)]), 10)).toBeNull();
    expect(workOf(actor("subagent", "inspector"), 0)).toBe("inspector");
    expect(workOf(actor("subagent", "commander", [act("messenger", 1)]), 10)).toBe("messenger");
    expect(workOf(actor("subagent", "commander"), 10)).toBeNull();
  });
});

describe("character.json", () => {
  it("has a face for every face and a prop for every working role", () => {
    for (const k of FACES) expect(character.faces).toHaveProperty(k);
    const roles: Role[] = ["scout", "smith", "engineer", "inspector", "messenger", "diplomat", "scribe", "painter", "operator", "sentry"];
    for (const r of roles) expect(PROPS).toContain(ROLE_PROP[r]);
  });
  it("uses the page's faction colours", () => {
    expect(character.colors["claude-code"]).toBe(FACTION_COLOR["claude-code"]);
    expect(character.colors.codex).toBe(FACTION_COLOR.codex);
  });
});
