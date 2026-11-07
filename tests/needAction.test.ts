// What a 需要你 row offers (spec 2026-11-07 D27 B4): never "resume" for a session still waiting in its terminal.
import { describe, expect, it } from "vitest";
import { needAction } from "../packages/web/src/ui/needAction.ts";

describe("needAction", () => {
  it("a held decision or a question from the logs: decide on the page", () => {
    expect(needAction({ state: "waiting" }, true, false)).toBe("decide");
    expect(needAction({ state: "waiting", ask: [] as never }, false, null)).toBe("decide");
  });
  it("waiting with the ask hook off: offer to turn it on", () => {
    expect(needAction({ state: "waiting" }, false, false)).toBe("enable");
    expect(needAction({ state: "maybe-waiting" }, false, false)).toBe("enable");
  });
  it("waiting with the hook on, or no server to ask: answer in the terminal", () => {
    expect(needAction({ state: "waiting" }, false, true)).toBe("terminal");
    expect(needAction({ state: "waiting" }, false, null)).toBe("terminal");
  });
  it("a finished or failed turn: copy the resume command (the terminal may be gone)", () => {
    expect(needAction({ state: "turn-done" }, false, true)).toBe("resume");
    expect(needAction({ state: "error" }, false, false)).toBe("resume");
  });
});
