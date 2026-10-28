import { describe, expect, it } from "vitest";
import { fromHash, toHash, type Selection } from "../packages/web/src/selection.ts";

describe("selection in the URL", () => {
  const cases: Selection[] = [
    { kind: "task", district: "claude-code|/Users/me/code/a|b", taskId: "abc~123" },
    { kind: "site", district: "codex|临时工地" },
    { kind: "agent", district: "claude-code|/p/项目 x", agentId: "agent-scout" },
  ];
  for (const s of cases) it(`round-trips a ${s.kind}`, () => expect(fromHash(toHash(s))).toEqual(s));

  it("writes nothing for no selection", () => {
    expect(toHash(null)).toBe("");
    expect(fromHash("")).toBeNull();
  });

  it("reads malformed hashes as no selection", () => {
    for (const h of ["#task=", "#bogus=1", "#task=onlydistrict", "#agent=%E0%A4%A", "#site="]) expect(fromHash(h), h).toBeNull();
  });
});
