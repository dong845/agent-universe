// The guided tour (spec 2026-11-05 B1): which steps, in which order, for which world.
import { describe, expect, it } from "vitest";
import { tourSteps } from "../packages/web/src/ui/tourSteps.ts";

describe("tourSteps", () => {
  it("does not start by itself on a page opened with a link to something", async () => {
    const { autoStart } = await import("../packages/web/src/ui/tourSteps.ts");
    expect(autoStart({ done: false, hash: "" })).toBe(true);
    expect(autoStart({ done: false, hash: "#req=abc" })).toBe(false);
    expect(autoStart({ done: true, hash: "" })).toBe(false);
  });
  it("seven steps in the spec's order, each going somewhere", () => {
    const s = tourSteps({ source: "real", biggest: "claude-code|/p", hasRobot: true });
    expect(s.map((x) => x.id)).toEqual(["welcome", "stars", "planet", "city", "robot", "panels", "invite"]);
    // the welcome moves nothing: a page opened on a link keeps what it opened (e2e world.spec #req=)
    expect(s.map((x) => x.go)).toEqual(["stay", "overview", "focus", "enter", "follow", "stay", "leave"]);
    expect(s.find((x) => x.id === "planet")!.highlight).toEqual({ kind: "planet", key: "claude-code|/p" });
    expect(s.find((x) => x.id === "stars")!.highlight).toEqual({ kind: "star" });
  });
  it("the welcome says which world this is", () => {
    expect(tourSteps({ source: "real", biggest: "k", hasRobot: true })[0].text).toBe("tour.welcome.real");
    expect(tourSteps({ source: "demo", biggest: "k", hasRobot: true })[0].text).toBe("tour.welcome.demo");
    expect(tourSteps({ source: "share", biggest: "k", hasRobot: true })[0].text).toBe("tour.welcome.share");
  });
  it("no planet at all: no planet, city or robot steps", () => {
    expect(tourSteps({ source: "real", biggest: null, hasRobot: false }).map((x) => x.id)).toEqual(["welcome", "stars", "panels", "invite"]);
  });
  it("a city with no live robot keeps the robot step (it uses the history step's agents)", () => {
    expect(tourSteps({ source: "real", biggest: "k", hasRobot: false }).map((x) => x.id)).toContain("robot");
  });
});
