// The guided tour's steps (spec 2026-11-05 B1): each says what to show, where the camera goes and what
// to highlight. Pure, so the order and the cases are unit-tested; Tour.tsx carries them out.
import type { Key } from "../i18n/index.ts";

export type TourGo = "overview" | "focus" | "enter" | "follow" | "stay" | "leave";
export type TourHighlightTarget = { kind: "star" } | { kind: "planet"; key: string } | { kind: "robot" } | { kind: "dom"; /** the first of these test ids found on the page ("a|b") */ testid: string } | null;
export interface TourStep {
  id: "welcome" | "stars" | "planet" | "city" | "robot" | "panels" | "invite";
  title: Key;
  text: Key;
  go: TourGo;
  highlight: TourHighlightTarget;
}

/** a first visit starts the tour, unless the page was opened on a link to something (#req=…): that
 * visitor came for the thing the link names */
export function autoStart(o: { done: boolean; hash: string }): boolean {
  return !o.done && !o.hash.replace(/^#/, "");
}

/** `biggest`: the planet the tour visits (the one with most finished work); `hasRobot`: the city has a
 * live agent now (else the robot step follows one of the history step's standing agents) */
export function tourSteps(ctx: { source: "real" | "demo" | "share"; biggest: string | null; hasRobot: boolean }): TourStep[] {
  const steps: TourStep[] = [
    { id: "welcome", title: "tour.welcome.title", text: ctx.source === "demo" ? "tour.welcome.demo" : ctx.source === "share" ? "tour.welcome.share" : "tour.welcome.real", go: "stay", highlight: null },
    { id: "stars", title: "tour.stars.title", text: "tour.stars.text", go: "overview", highlight: { kind: "star" } },
  ];
  if (ctx.biggest) {
    steps.push(
      { id: "planet", title: "tour.planet.title", text: "tour.planet.text", go: "focus", highlight: { kind: "planet", key: ctx.biggest } },
      { id: "city", title: "tour.city.title", text: "tour.city.text", go: "enter", highlight: null },
      { id: "robot", title: "tour.robot.title", text: "tour.robot.text", go: "follow", highlight: { kind: "robot" } },
    );
  }
  steps.push(
    { id: "panels", title: "tour.panels.title", text: "tour.panels.text", go: "stay", highlight: { kind: "dom", testid: ctx.biggest ? "history|history-open" : "legend" } },
    { id: "invite", title: "tour.invite.title", text: "tour.invite.text", go: "leave", highlight: null },
  );
  return steps;
}
