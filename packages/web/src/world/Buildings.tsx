// The nine tool buildings, the hall with its sentry post, the warehouse and the bench.
// Low-poly placeholders in one material family; phase 5 swaps them for CC0 models.
import { BUILDINGS, type BuildingId } from "../../../schema/src/world.ts";
import { BUILDING_POS, HALL_BUILDING, SENTRY_BOOTH, WAREHOUSE, type Vec } from "../orchestrator/layout.ts";
import { useStore } from "../store.ts";
import { hoverHandlers } from "./hover.ts";
import { FACTION, ROLE_COLOR } from "./palette.ts";


/** a distinct silhouette per building so each reads at a glance */
function Shape({ id }: { id: BuildingId }) {
  const wall = FACTION.building;
  const dark = FACTION.buildingDark;
  const roof = FACTION.roof;
  switch (id) {
    case "library": // long hall with a pitched roof and columns
      return (
        <group>
          <mesh position={[0, 0.8, 0]} castShadow><boxGeometry args={[2.6, 1.6, 1.8]} /><meshStandardMaterial color={wall} /></mesh>
          <mesh position={[0, 1.95, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[1.95, 0.9, 4]} /><meshStandardMaterial color={roof} /></mesh>
          {[-0.9, -0.3, 0.3, 0.9].map((x) => (
            <mesh key={x} position={[x, 0.7, 0.98]}><cylinderGeometry args={[0.09, 0.09, 1.4, 8]} /><meshStandardMaterial color={FACTION.trim} /></mesh>
          ))}
        </group>
      );
    case "forge": // squat block with a tall chimney and a glowing hearth
      return (
        <group>
          <mesh position={[0, 0.65, 0]} castShadow><boxGeometry args={[2, 1.3, 1.8]} /><meshStandardMaterial color={dark} /></mesh>
          <mesh position={[0.6, 1.8, -0.4]} castShadow><cylinderGeometry args={[0.25, 0.3, 1.6, 8]} /><meshStandardMaterial color={roof} /></mesh>
          <mesh position={[0, 0.45, 0.91]}><boxGeometry args={[0.8, 0.5, 0.02]} /><meshStandardMaterial color="#ff7a1a" emissive="#ff5a00" emissiveIntensity={0.6} /></mesh>
        </group>
      );
    case "workshop": // shed with a sloped roof and a gear
      return (
        <group>
          <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[2.2, 1.4, 1.8]} /><meshStandardMaterial color={wall} /></mesh>
          <mesh position={[0, 1.55, 0]} rotation={[0.25, 0, 0]} castShadow><boxGeometry args={[2.4, 0.15, 2.1]} /><meshStandardMaterial color={roof} /></mesh>
          <mesh position={[0, 1.0, 0.92]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.32, 0.1, 6, 12]} /><meshStandardMaterial color="#555" /></mesh>
        </group>
      );
    case "training": // open field with goal posts
      return (
        <group>
          <mesh position={[0, 0.05, 0]} receiveShadow><boxGeometry args={[2.6, 0.1, 2]} /><meshStandardMaterial color="#7fb069" /></mesh>
          {[-1, 1].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, 0.7, -0.6]}><cylinderGeometry args={[0.06, 0.06, 1.4, 6]} /><meshStandardMaterial color="#fff" /></mesh>
              <mesh position={[0, 0.7, 0.6]}><cylinderGeometry args={[0.06, 0.06, 1.4, 6]} /><meshStandardMaterial color="#fff" /></mesh>
              <mesh position={[0, 1.4, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.06, 0.06, 1.2, 6]} /><meshStandardMaterial color="#fff" /></mesh>
            </group>
          ))}
        </group>
      );
    case "port": // dock planks, a small house and a mast
      return (
        <group>
          <mesh position={[0, 0.06, 0]}><boxGeometry args={[2.6, 0.12, 1.6]} /><meshStandardMaterial color="#9c6b3c" /></mesh>
          <mesh position={[-0.5, 0.6, 0]} castShadow><boxGeometry args={[1.2, 1, 1.2]} /><meshStandardMaterial color={wall} /></mesh>
          <mesh position={[0.8, 1.2, 0]}><cylinderGeometry args={[0.06, 0.06, 2.4, 6]} /><meshStandardMaterial color="#6b4423" /></mesh>
          <mesh position={[1.1, 1.6, 0]}><boxGeometry args={[0.6, 0.4, 0.02]} /><meshStandardMaterial color="#e8eef5" /></mesh>
        </group>
      );
    case "embassy": // block with a dome and a flag
      return (
        <group>
          <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[2, 1.4, 1.8]} /><meshStandardMaterial color={FACTION.trim} /></mesh>
          <mesh position={[0, 1.4, 0]} castShadow><sphereGeometry args={[0.75, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={wall} /></mesh>
          <mesh position={[0, 2.4, 0]}><cylinderGeometry args={[0.04, 0.04, 0.9, 6]} /><meshStandardMaterial color="#333" /></mesh>
          <mesh position={[0.22, 2.7, 0]}><boxGeometry args={[0.4, 0.25, 0.02]} /><meshStandardMaterial color={ROLE_COLOR.diplomat} /></mesh>
        </group>
      );
    case "council": // round hall with a conical roof
      return (
        <group>
          <mesh position={[0, 0.75, 0]} castShadow><cylinderGeometry args={[1.05, 1.05, 1.5, 16]} /><meshStandardMaterial color={wall} /></mesh>
          <mesh position={[0, 1.95, 0]} castShadow><coneGeometry args={[1.3, 0.9, 16]} /><meshStandardMaterial color={roof} /></mesh>
        </group>
      );
    case "studio": // tall gable with a big window and an easel
      return (
        <group>
          <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[1.8, 1.8, 1.6]} /><meshStandardMaterial color={wall} /></mesh>
          <mesh position={[0, 2.1, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[1.35, 0.7, 4]} /><meshStandardMaterial color={roof} /></mesh>
          <mesh position={[0, 1.1, 0.81]}><boxGeometry args={[1.1, 0.9, 0.02]} /><meshStandardMaterial color="#bfe3ff" /></mesh>
        </group>
      );
    case "control": // low console room with an antenna and a screen
      return (
        <group>
          <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[2, 1.1, 1.6]} /><meshStandardMaterial color={dark} /></mesh>
          <mesh position={[0, 0.7, 0.81]}><boxGeometry args={[1.2, 0.55, 0.02]} /><meshStandardMaterial color="#0e2a33" emissive="#0891b2" emissiveIntensity={0.5} /></mesh>
          <mesh position={[0.6, 1.6, -0.3]}><cylinderGeometry args={[0.04, 0.04, 1.1, 6]} /><meshStandardMaterial color="#444" /></mesh>
          <mesh position={[0.6, 2.2, -0.3]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#f87171" /></mesh>
        </group>
      );
  }
}

/** face the site so doors and windows point at the work */
function facing(p: Vec): number {
  return Math.atan2(-p.x, -p.z);
}

export function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b) => {
        const p = BUILDING_POS[b.id];
        return (
          <group key={b.id} position={[p.x, 0, p.z]}>
            <group rotation={[0, facing(p), 0]} {...hoverHandlers({ kind: "building", id: b.id })}>
              <Shape id={b.id} />
              {/* invisible, simple hit box so hovering never misses a thin mesh */}
              <mesh position={[0, 1.2, 0]} visible={false}><boxGeometry args={[2.8, 2.6, 2.2]} /></mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}

export function Hall() {
  return (
    <group>
      {/* door turned toward the camera, so a figure waiting in front of it stays in view */}
      <group position={[HALL_BUILDING.x, 0, HALL_BUILDING.z]} rotation={[0, Math.PI / 4, 0]} {...hoverHandlers({ kind: "faction" })}>
        <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[3.4, 1.8, 1.6]} /><meshStandardMaterial color={FACTION.building} /></mesh>
        <mesh position={[0, 2.05, 0]} castShadow><boxGeometry args={[3.8, 0.5, 2]} /><meshStandardMaterial color={FACTION.roof} /></mesh>
        <HallLight />
      </group>
      <group position={[SENTRY_BOOTH.x, 0, SENTRY_BOOTH.z]}>
        <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[0.8, 1.4, 0.8]} /><meshStandardMaterial color={FACTION.buildingDark} /></mesh>
        <mesh position={[0, 1.55, 0]}><coneGeometry args={[0.7, 0.5, 4]} /><meshStandardMaterial color={FACTION.roof} /></mesh>
      </group>
      <group position={[WAREHOUSE.x, 0, WAREHOUSE.z]} {...hoverHandlers({ kind: "faction" })}>
        <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[1.8, 1.2, 1.4]} /><meshStandardMaterial color="#b9a27f" /></mesh>
        <mesh position={[0, 1.35, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.75, 0.75, 1.8, 3]} /><meshStandardMaterial color={FACTION.roof} /></mesh>
      </group>
    </group>
  );
}

/** the hall lights up while a task is being handed over (plan "接单") */
function HallLight() {
  const lit = useStore((s) => s.timeline.hallLit.some((h) => s.uiT >= h.start && s.uiT < h.end));
  return (
    <mesh position={[0, 0.8, 0.81]}>
      <boxGeometry args={[1, 1.1, 0.02]} />
      <meshStandardMaterial color={lit ? "#fff3b0" : "#5b3a29"} emissive={lit ? "#ffd84d" : "#000"} emissiveIntensity={lit ? 1.2 : 0} />
    </mesh>
  );
}
