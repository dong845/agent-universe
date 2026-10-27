// A district's own ground: a slightly darker disc marking the town, the plaza, and the paths from
// the plaza to each building. Paths carry data: each widens with how often its building is used.
import { keys } from "../../../schema/src/aggregate.ts";
import { BUILDINGS } from "../../../schema/src/world.ts";
import { BUILDING_POS, COMMANDER_POST, HALL, HALL_BUILDING, SITE, WAREHOUSE, doorOf, type Vec } from "../orchestrator/layout.ts";
import { absTime, useStore } from "../store.ts";
import { useRuntime } from "./districtContext.tsx";
import { useLook } from "./looks.ts";
import { Mat } from "./Mat.tsx";

/** a flat strip from a to b */
export function Strip({ a, b, width, color, y = 0.03 }: { a: Vec; b: Vec; width: number; color: string; y?: number }) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ang = Math.atan2(b.x - a.x, b.z - a.z);
  return (
    <mesh position={[(a.x + b.x) / 2, y, (a.z + b.z) / 2]} rotation={[0, ang, 0]} receiveShadow>
      <boxGeometry args={[width, 0.04, len + width]} />
      <Mat color={color} />
    </mesh>
  );
}

export function DistrictGround() {
  const look = useLook();
  const { district } = useRuntime();
  const t = useStore((s) => s.uiT);
  const ledger = useStore((s) => s.ledger);
  const abs = absTime(t);
  return (
    <group>
      {/* the town's footprint: trodden ground, darker than the fields around it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow>
        <circleGeometry args={[district.radius, 64]} />
        <Mat color={look.ground.topDark} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[SITE.x, 0.016, SITE.z + 0.6]} receiveShadow>
        <circleGeometry args={[5.4, 56]} />
        <Mat color={look.ground.plaza} />
      </mesh>
      <Strip a={COMMANDER_POST} b={{ x: HALL.x, z: HALL.z - 0.6 }} width={1.3} color={look.ground.path} />
      <Strip a={SITE} b={WAREHOUSE} width={0.6} color={look.ground.path} />
      <Strip a={HALL} b={HALL_BUILDING} width={0.9} color={look.ground.path} />
      {BUILDINGS.map((b) => {
        // wear: 0.35 wide unused, growing with log2 of the calls so far, up to 1.2
        const calls = ledger.buildingAt(keys.building(district, b.id), abs).calls;
        const width = Math.min(1.2, 0.35 + 0.22 * Math.log2(1 + calls));
        const p = BUILDING_POS[b.id];
        const d = Math.hypot(p.x, p.z);
        return <Strip key={b.id} a={{ x: (p.x / d) * 4.6, z: (p.z / d) * 4.6 }} b={doorOf(b.id)} width={width} color={look.ground.path} />;
      })}
    </group>
  );
}
