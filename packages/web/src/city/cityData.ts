// A planet's city on flat ground (owner 2026-11-01: clicking a planet enters its city). The city is
// the town layout at 1 world unit per layout unit; agents walk between its buildings on the same
// timeline the old district used, with this town's places. Pure.
import { BUILDINGS, type BuildingId } from "../../../schema/src/world.ts";
import type { Places, Vec } from "../orchestrator/layout.ts";
import type { Pose } from "../orchestrator/timeline.ts";
import type { Spot, TownLayout } from "../v3/townLayout.ts";
import { WORK_NAMES } from "../v3/townLayout.ts";
import { t } from "../i18n/index.ts";

const toward = (a: Vec, b: Vec, d: number): Vec => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz);
  return l < 1e-9 ? { x: a.x, z: a.z + d } : { x: a.x + (dx / l) * d, z: a.z + (dz / l) * d };
};
const at = (s: Spot): Vec => ({ x: s.x, z: s.z });
const CENTRE: Vec = { x: 0, z: 0 };

/**
 * Where the figures of one request go in this town. Each tool building is the town's public building
 * for that kind of work; a kind of work with no building here (done fewer than 5 times) is done at the
 * task hall. The site is the request's own house when it stands in the town, else the square.
 */
export function cityPlaces(layout: TownLayout, requestId?: string): Places {
  const hallSpot = layout.spots.find((s) => s.info.kind === "hall");
  const hall = hallSpot ? at(hallSpot) : { x: -2, z: 0 };
  const hallWait = toward(hall, CENTRE, 1.3);
  const notice = layout.spots.find((s) => s.info.kind === "notice");
  const byWork = new Map<string, Spot>();
  for (const s of layout.spots) if (s.info.kind === "public") byWork.set(s.info.work, s);
  const spotOf = (b: BuildingId): Spot | undefined => {
    const role = BUILDINGS.find((x) => x.id === b)?.role;
    return role ? byWork.get(role) : undefined;
  };
  const house = requestId ? layout.spots.find((s) => s.info.kind === "house" && s.info.requestId === requestId) : undefined;
  const site = house ? at(house) : { x: 0, z: 1.6 };
  const post = house ? toward(site, CENTRE, 1.25) : { x: 1.3, z: 2.2 };
  return {
    building: (b) => {
      const s = spotOf(b);
      return s ? at(s) : hall;
    },
    door: (b, lane) => {
      const s = spotOf(b);
      const base = s ? at(s) : hall;
      // stand on the side facing the square, spread along the front
      const front = toward(base, CENTRE, (s ? s.size : 1.8) * 0.55 + 0.55);
      const side = lane === 0 ? 0 : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * 0.55;
      const dx = front.x - base.x, dz = front.z - base.z;
      const l = Math.hypot(dx, dz) || 1;
      return { x: front.x - (dz / l) * side, z: front.z + (dx / l) * side };
    },
    hall: hallWait,
    commanderPost: post,
    sentryPost: notice ? toward(at(notice), CENTRE, 1.0) : toward(hall, CENTRE, 2.2),
    warehouse: CENTRE,
    scaffold: (slot) => {
      const a = (slot % 6) * (Math.PI / 3) + 0.5;
      return { x: site.x + Math.cos(a) * 1.7, z: site.z + Math.sin(a) * 1.7 };
    },
  };
}

/** what a figure is doing, in plain words, for the bubble over its head */
export function activityOf(pose: Pose, building: BuildingId | undefined, subagent: boolean): string {
  const role = building ? BUILDINGS.find((b) => b.id === building)?.role : undefined;
  const work = role ? WORK_NAMES[role] ?? role : "";
  switch (pose) {
    case "work": return work || t("act.work");
    case "think": return t("act.think");
    case "walk": return work ? t("act.walkTo", { work }) : t("act.walk");
    case "carry": return subagent ? t("act.carrySub") : t("act.carry");
    case "dispatch": return t("act.dispatch");
    case "raise_hand": return t("act.raise");
    case "fall": return t("act.fall");
    case "shake": return t("act.shake");
    case "pack": return t("act.pack");
    case "report": return t("act.report");
    // between events the model is working on its next step
    default: return t("act.think");
  }
}
