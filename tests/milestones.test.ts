// Celebrations (spec 2026-11-05 C4): only for milestones crossed while the page is open, each once.
import { describe, expect, it } from "vitest";
import { newMilestones, type Counts } from "../packages/web/src/ui/milestones.ts";

const c = (products: number, lit = 0, projects: Record<string, number> = {}): Counts => ({ products, shells: { "claude-code": { lit, total: 1280 } }, projects });

describe("newMilestones", () => {
  it("the first load celebrates nothing", () => expect(newMilestones(null, c(500, 900, { a: 3 }), new Set())).toEqual([]));
  it("crossing 100 finished pieces", () => {
    expect(newMilestones(c(99), c(100), new Set()).map((m) => m.id)).toEqual(["products-100"]);
  });
  it("crossing two at once", () => {
    expect(newMilestones(c(95), c(260), new Set()).map((m) => m.id)).toEqual(["products-100", "products-250"]);
  });
  it("never one already seen", () => {
    expect(newMilestones(c(99), c(100), new Set(["products-100"]))).toEqual([]);
  });
  it("each tenth of a Dyson shell", () => {
    expect(newMilestones(c(0, 115), c(0, 269), new Set()).map((m) => m.id)).toEqual(["shell-claude-code-10", "shell-claude-code-20"]);
  });
  it("a project's first finished piece", () => {
    const m = newMilestones(c(5, 0, { a: 2 }), c(6, 0, { a: 2, b: 1 }), new Set());
    expect(m).toEqual([{ id: "first-b", kind: "first", where: "b" }]);
  });
});
