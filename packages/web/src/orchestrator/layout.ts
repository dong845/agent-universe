// World coordinates of one district (y is up; the ground is the x–z plane).
import { BUILDINGS, type BuildingId } from "../../../schema/src/world.ts";

export interface Vec {
  x: number;
  z: number;
}

export const SITE: Vec = { x: 0, z: 0 };
/**
 * Where the commander stands: beside the site on the camera side, never inside the floors it builds.
 * The default camera looks from +x,+z, so "in front" means larger x + z.
 */
export const COMMANDER_POST: Vec = { x: 2.4, z: 2.2 };
/** the hall building; its door faces the camera */
export const HALL_BUILDING: Vec = { x: -1.8, z: 12.0 };
/** where a figure waits at the hall, in front of the door */
export const HALL: Vec = { x: 0.6, z: 12.6 };
/** the sentry's booth and the spot in front of it (decisions D11) */
export const SENTRY_BOOTH: Vec = { x: 4.4, z: 11.2 };
export const SENTRY_POST: Vec = { x: 5.2, z: 12.2 };
export const WAREHOUSE: Vec = { x: -6.5, z: 9.5 };
export const BENCH: Vec = { x: 6.5, z: 9.5 };
export const BUILDING_RADIUS = 9;
export const MAX_SCAFFOLDS = 6;

/**
 * The nine tool buildings sit on an arc behind the site, leaving the front (toward the hall and
 * the default camera) open, so no building hides the site.
 */
export const BUILDING_POS: Record<BuildingId, Vec> = Object.fromEntries(
  BUILDINGS.map((b, i) => {
    const from = (-200 * Math.PI) / 180;
    const to = (20 * Math.PI) / 180;
    const a = from + ((to - from) * i) / (BUILDINGS.length - 1);
    return [b.id, { x: Math.cos(a) * BUILDING_RADIUS, z: Math.sin(a) * BUILDING_RADIUS }];
  }),
) as Record<BuildingId, Vec>;

/**
 * Where a figure stands to work at a building: on the side facing the site. `lane` spreads figures
 * that work at one building at the same time along the front (0 = centre, then right, left, …).
 */
export function doorOf(b: BuildingId, lane = 0): Vec {
  const p = BUILDING_POS[b];
  const d = Math.hypot(p.x, p.z);
  const side = lane === 0 ? 0 : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * 0.85;
  // tangent to the ring of buildings
  const tx = -p.z / d;
  const tz = p.x / d;
  return { x: p.x - (p.x / d) * 1.8 + tx * side, z: p.z - (p.z / d) * 1.8 + tz * side };
}

/**
 * Scaffold slots in spawn order. Each side is a row along the camera's horizontal (x − z), so
 * neighbours sit side by side on screen instead of stacking: three to the left of the site, then
 * three to the right behind the commander's post.
 */
const SLOTS: Vec[] = [
  { x: -3.0, z: 1.6 }, { x: -5.2, z: 3.8 }, { x: -7.4, z: 6.0 },
  { x: 3.0, z: -1.6 }, { x: 4.4, z: -3.0 }, { x: 5.6, z: -4.2 },
];
export function scaffoldPos(slot: number): Vec {
  return SLOTS[slot % SLOTS.length];
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function lerp(a: Vec, b: Vec, f: number): Vec {
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

/**
 * Where a timeline's figures go. The default is the district above; the star-system view's cities pass
 * their own town's buildings (D18).
 */
export interface Places {
  /** a tool building's middle (token cubes fly from here) */
  building(b: BuildingId): Vec;
  /** where a figure stands to work at a building; `lane` spreads figures working side by side */
  door(b: BuildingId, lane: number): Vec;
  hall: Vec;
  commanderPost: Vec;
  sentryPost: Vec;
  warehouse: Vec;
  scaffold(slot: number): Vec;
}

export const DEFAULT_PLACES: Places = {
  building: (b) => BUILDING_POS[b],
  door: doorOf,
  hall: HALL,
  commanderPost: COMMANDER_POST,
  sentryPost: SENTRY_POST,
  warehouse: WAREHOUSE,
  scaffold: scaffoldPos,
};
