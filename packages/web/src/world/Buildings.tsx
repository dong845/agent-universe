// The nine tool buildings, the hall with its sentry booth, and the warehouse — built from a small
// kit of parts so every look restyles them at once. Windows light up while someone works inside.
import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import { ExtrudeGeometry, Shape } from "three";
import { BUILDINGS, type BuildingId } from "../../../schema/src/world.ts";
import { BUILDING_POS, HALL_BUILDING, SENTRY_BOOTH, WAREHOUSE, type Vec } from "../orchestrator/layout.ts";
import { sampleActor } from "../orchestrator/timeline.ts";
import { useStore } from "../store.ts";
import { hoverHandlers } from "./hover.ts";
import { useLook, type Look } from "./looks.ts";
import { Mat } from "./Mat.tsx";

type V3 = [number, number, number];

/** a box that is bevelled in the rounded looks */
export function Block({ size, at, color, glow, emissive, cast = true }: { size: V3; at: V3; color: string; glow?: number; emissive?: string; cast?: boolean }) {
  const look = useLook();
  if (look.rounded) {
    const r = Math.min(0.14, Math.min(...size) * 0.22);
    return (
      <RoundedBox args={size} radius={r} smoothness={3} position={at} castShadow={cast} receiveShadow>
        <Mat color={color} glow={glow} emissive={emissive} />
      </RoundedBox>
    );
  }
  return (
    <mesh position={at} castShadow={cast} receiveShadow>
      <boxGeometry args={size} />
      <Mat color={color} glow={glow} emissive={emissive} />
    </mesh>
  );
}

/** a gable roof: a triangular prism `w` long, `d` deep, `h` high */
function Gable({ w, d, h, at, color }: { w: number; d: number; h: number; at: V3; color: string }) {
  const geo = useMemo(() => {
    const s = new Shape();
    s.moveTo(-d / 2, 0);
    s.lineTo(d / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    return g;
  }, [w, d, h]);
  return (
    <mesh geometry={geo} position={at} castShadow receiveShadow>
      <Mat color={color} />
    </mesh>
  );
}

function Win({ at, size = [0.34, 0.4], lit, look }: { at: V3; size?: [number, number]; lit: boolean; look: Look }) {
  return (
    <mesh position={at}>
      <boxGeometry args={[size[0], size[1], 0.04]} />
      <Mat color={lit ? look.windowGlow : "#3d3a4a"} emissive={look.windowGlow} glow={lit ? 1.6 : look.id === "dusk" ? 0.35 : 0} />
    </mesh>
  );
}

function Cyl({ r, h, at, color, seg = 16 }: { r: number; h: number; at: V3; color: string; seg?: number }) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <cylinderGeometry args={[r, r, h, seg]} />
      <Mat color={color} />
    </mesh>
  );
}

function Model({ id, lit }: { id: BuildingId; lit: boolean }) {
  const look = useLook();
  const c = look.building[id];
  const roof = look.id === "board" ? c.accent : look.roof;
  const plinth = <Block size={[2.9, 0.18, 2.3]} at={[0, 0.09, 0]} color={look.ground.plaza} cast={false} />;
  switch (id) {
    case "library":
      return (
        <group>
          {plinth}
          <Block size={[2.6, 1.5, 1.7]} at={[0, 0.93, 0]} color={c.wall} />
          <Gable w={2.9} d={2.1} h={0.95} at={[0, 1.68, 0]} color={roof} />
          {[-0.85, -0.3, 0.3, 0.85].map((x) => <Cyl key={x} r={0.08} h={1.3} at={[x, 0.85, 0.92]} color={look.trim} seg={8} />)}
          <Win at={[0, 2.05, 1.06]} size={[0.3, 0.3]} lit={lit} look={look} />
          <Win at={[-0.58, 1.0, 0.87]} lit={lit} look={look} />
          <Win at={[0.58, 1.0, 0.87]} lit={lit} look={look} />
          <Block size={[0.5, 0.6, 0.08]} at={[0, 0.5, 0.88]} color={c.accent} />
        </group>
      );
    case "forge":
      return (
        <group>
          {plinth}
          <Block size={[2.1, 1.25, 1.8]} at={[0, 0.8, 0]} color={c.wall} />
          <Gable w={2.3} d={2.1} h={0.55} at={[0, 1.42, 0]} color={roof} />
          <Cyl r={0.28} h={1.9} at={[0.6, 1.9, -0.45]} color={look.id === "board" ? c.wall : "#5a4c46"} seg={8} />
          <mesh position={[0, 0.62, 0.91]}>
            <boxGeometry args={[0.9, 0.55, 0.05]} />
            <Mat color={c.accent} emissive={c.accent} glow={lit ? 2.4 : 0.8} />
          </mesh>
          <Block size={[0.5, 0.2, 0.26]} at={[-0.6, 0.48, 1.35]} color="#4a4a52" />
          <Block size={[0.24, 0.26, 0.2]} at={[-0.6, 0.27, 1.35]} color="#4a4a52" />
        </group>
      );
    case "workshop":
      return (
        <group>
          {plinth}
          <Block size={[2.3, 1.35, 1.8]} at={[0, 0.85, 0]} color={c.wall} />
          <mesh position={[0, 1.65, 0.05]} rotation={[0.22, 0, 0]} castShadow>
            <boxGeometry args={[2.6, 0.14, 2.2]} />
            <Mat color={roof} />
          </mesh>
          <mesh position={[0.55, 1.0, 0.93]}>
            <torusGeometry args={[0.28, 0.09, 8, 12]} />
            <Mat color={c.accent} />
          </mesh>
          <Win at={[-0.5, 1.0, 0.92]} lit={lit} look={look} />
          <Block size={[0.4, 0.4, 0.4]} at={[1.35, 0.38, 0.7]} color={look.wood} />
          <Block size={[0.32, 0.32, 0.32]} at={[1.3, 0.74, 0.7]} color={look.wood} />
        </group>
      );
    case "training":
      return (
        <group>
          <Block size={[2.9, 0.16, 2.3]} at={[0, 0.08, 0]} color={c.wall} cast={false} />
          {[-1.05, 1.05].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <Cyl r={0.06} h={1.3} at={[0, 0.8, -0.55]} color={c.accent} seg={8} />
              <Cyl r={0.06} h={1.3} at={[0, 0.8, 0.55]} color={c.accent} seg={8} />
              <mesh position={[0, 1.42, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.06, 0.06, 1.16, 8]} /><Mat color={c.accent} /></mesh>
            </group>
          ))}
          {/* target: red while a test runs */}
          <Cyl r={0.05} h={0.8} at={[0, 0.55, 0]} color={look.wood} seg={6} />
          <mesh position={[0, 1.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.32, 0.32, 0.08, 20]} />
            <Mat color={lit ? "#ff5a4f" : "#f2f2f2"} emissive="#ff5a4f" glow={lit ? 0.8 : 0} />
          </mesh>
        </group>
      );
    case "port":
      return (
        <group>
          <mesh position={[0, 0.03, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.5, 24]} />
            <Mat color={c.accent} />
          </mesh>
          {[-0.8, -0.4, 0, 0.4, 0.8].map((x) => <Block key={x} size={[0.34, 0.08, 2.2]} at={[x, 0.2, 0.2]} color={look.wood} />)}
          <Block size={[1.1, 0.9, 1.0]} at={[-0.55, 0.69, -0.4]} color={c.wall} />
          <Gable w={1.3} d={1.25} h={0.45} at={[-0.55, 1.14, -0.4]} color={roof} />
          <Cyl r={0.05} h={2.3} at={[0.7, 1.35, 0.4]} color={look.wood} seg={6} />
          <mesh position={[0.95, 1.6, 0.4]} castShadow>
            <boxGeometry args={[0.5, 0.9, 0.03]} />
            <Mat color={look.trim} />
          </mesh>
          <Win at={[-0.55, 0.75, 0.12]} lit={lit} look={look} />
        </group>
      );
    case "embassy":
      return (
        <group>
          {plinth}
          <Block size={[2.1, 1.3, 1.7]} at={[0, 0.83, 0]} color={c.wall} />
          <mesh position={[0, 1.48, 0]} castShadow>
            <sphereGeometry args={[0.72, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <Mat color={c.accent} />
          </mesh>
          {[-0.65, 0, 0.65].map((x) => <Cyl key={x} r={0.08} h={1.1} at={[x, 0.75, 0.9]} color={look.trim} seg={8} />)}
          <Cyl r={0.03} h={0.9} at={[0, 2.55, 0]} color="#333" seg={6} />
          <mesh position={[0.24, 2.83, 0]}><boxGeometry args={[0.44, 0.26, 0.03]} /><Mat color={look.roof} /></mesh>
          <Win at={[-0.35, 1.05, 0.87]} size={[0.26, 0.4]} lit={lit} look={look} />
          <Win at={[0.35, 1.05, 0.87]} size={[0.26, 0.4]} lit={lit} look={look} />
        </group>
      );
    case "council":
      return (
        <group>
          <Cyl r={1.2} h={0.18} at={[0, 0.09, 0]} color={look.ground.plaza} seg={24} />
          <Cyl r={1.0} h={1.45} at={[0, 0.9, 0]} color={c.wall} seg={20} />
          <mesh position={[0, 2.05, 0]} castShadow>
            <coneGeometry args={[1.25, 0.95, 20]} />
            <Mat color={roof} />
          </mesh>
          <Win at={[0, 1.0, 1.0]} lit={lit} look={look} />
          <Win at={[0.7, 1.0, 0.72]} size={[0.26, 0.4]} lit={lit} look={look} />
          <Win at={[-0.7, 1.0, 0.72]} size={[0.26, 0.4]} lit={lit} look={look} />
          <mesh position={[0, 2.75, 0]}><sphereGeometry args={[0.1, 10, 8]} /><Mat color={c.accent} /></mesh>
        </group>
      );
    case "studio":
      return (
        <group>
          {plinth}
          <Block size={[1.8, 1.7, 1.6]} at={[0, 1.03, 0]} color={c.wall} />
          <Gable w={2.0} d={1.95} h={0.85} at={[0, 1.88, 0]} color={roof} />
          <Win at={[0, 1.15, 0.82]} size={[1.0, 0.85]} lit={lit} look={look} />
          <mesh position={[1.25, 0.65, 0.8]} rotation={[-0.15, -0.4, 0]} castShadow><boxGeometry args={[0.5, 0.62, 0.04]} /><Mat color="#ffffff" /></mesh>
          <mesh position={[1.25, 0.68, 0.81]} rotation={[-0.15, -0.4, 0]}><boxGeometry args={[0.3, 0.3, 0.05]} /><Mat color={c.accent} /></mesh>
        </group>
      );
    case "control":
      return (
        <group>
          {plinth}
          <Block size={[2.1, 1.1, 1.7]} at={[0, 0.73, 0]} color={c.wall} />
          <Block size={[2.3, 0.12, 1.9]} at={[0, 1.34, 0]} color={roof} />
          <mesh position={[0, 0.82, 0.87]}>
            <boxGeometry args={[1.3, 0.55, 0.04]} />
            <Mat color="#10263a" emissive="#38bdf8" glow={lit ? 1.8 : 0.5} />
          </mesh>
          <Cyl r={0.04} h={1.0} at={[0.6, 1.9, -0.35]} color="#555555" seg={6} />
          <mesh position={[0.6, 2.4, -0.35]} rotation={[0.6, 0, 0]}>
            <sphereGeometry args={[0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
            <Mat color={look.trim} />
          </mesh>
        </group>
      );
  }
}

/** face the site so doors and windows point at the work */
function facing(p: Vec): number {
  return Math.atan2(-p.x, -p.z);
}

export function Buildings() {
  const tl = useStore((s) => s.timeline);
  const t = useStore((s) => s.uiT);
  // a building is lit while a figure is working inside it right now
  const busy = new Set(
    tl.actors.map((a) => sampleActor(a, t)).filter((s) => s.visible && s.pose === "work" && s.building).map((s) => s.building!),
  );
  return (
    <group>
      {BUILDINGS.map((b) => {
        const p = BUILDING_POS[b.id];
        return (
          <group key={b.id} position={[p.x, 0, p.z]}>
            <group rotation={[0, facing(p), 0]} {...hoverHandlers({ kind: "building", id: b.id })}>
              <Model id={b.id} lit={busy.has(b.id)} />
              <mesh position={[0, 1.2, 0]} visible={false}><boxGeometry args={[2.8, 2.6, 2.2]} /></mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}

export function Hall() {
  const look = useLook();
  const lit = useStore((s) => s.timeline.hallLit.some((h) => s.uiT >= h.start && s.uiT < h.end));
  return (
    <group>
      {/* door turned toward the camera, so a figure waiting in front of it stays in view */}
      <group position={[HALL_BUILDING.x, 0, HALL_BUILDING.z]} rotation={[0, Math.PI / 4, 0]} {...hoverHandlers({ kind: "faction" })}>
        <Block size={[3.6, 0.2, 2.2]} at={[0, 0.1, 0]} color={look.ground.plaza} cast={false} />
        <Block size={[3.2, 1.7, 1.6]} at={[0, 1.05, 0]} color={look.hall.wall} />
        <Gable w={3.5} d={2.0} h={0.9} at={[0, 1.88, 0]} color={look.id === "board" ? look.hall.accent : look.roof} />
        <mesh position={[0, 0.75, 0.82]}>
          <boxGeometry args={[0.8, 1.1, 0.05]} />
          <Mat color={lit ? look.windowGlow : "#5b3a29"} emissive={look.windowGlow} glow={lit ? 2.2 : look.id === "dusk" ? 0.5 : 0} />
        </mesh>
        <Win at={[-1.05, 1.15, 0.82]} lit={lit} look={look} />
        <Win at={[1.05, 1.15, 0.82]} lit={lit} look={look} />
        <Block size={[1.4, 0.3, 0.08]} at={[0, 1.75, 0.84]} color={look.hall.accent} />
      </group>
      <group position={[SENTRY_BOOTH.x, 0, SENTRY_BOOTH.z]} rotation={[0, Math.PI / 4, 0]}>
        <Block size={[0.9, 1.3, 0.9]} at={[0, 0.65, 0]} color={look.hall.wall} />
        <mesh position={[0, 1.55, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[0.8, 0.55, 4]} /><Mat color={look.roof} /></mesh>
        <mesh position={[0, 0.75, 0.46]}><boxGeometry args={[0.5, 0.5, 0.03]} /><Mat color="#3d3a4a" /></mesh>
      </group>
      <group position={[WAREHOUSE.x, 0, WAREHOUSE.z]} rotation={[0, Math.PI / 5, 0]} {...hoverHandlers({ kind: "faction" })}>
        <Block size={[2.0, 1.1, 1.5]} at={[0, 0.55, 0]} color={look.wood} />
        <mesh position={[0, 1.1, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.78, 0.78, 2.1, 12, 1, false, 0, Math.PI]} />
          <Mat color={look.id === "board" ? "#22c55e" : look.roof} />
        </mesh>
        <Block size={[0.8, 0.8, 0.06]} at={[0, 0.5, 0.77]} color={look.trim} />
      </group>
    </group>
  );
}
