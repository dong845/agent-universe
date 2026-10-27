// The task site: foundation, one floor per successful edit, merged subagent floors, rework smoke
// and cloud, roof and flag at task end; plus the subagent scaffolds around it.
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { SITE } from "../orchestrator/layout.ts";
import { activeAt, floorsAt } from "../orchestrator/timeline.ts";
import { useStore } from "../store.ts";
import { hoverHandlers } from "./hover.ts";
import { Block } from "./Buildings.tsx";
import { useLook } from "./looks.ts";
import { Mat } from "./Mat.tsx";
import { MAIN_FLOOR, SUBAGENT } from "./palette.ts";

export const FLOOR_H = 0.45;
const BASE_H = 0.25;

/** height of the site's top at time t, so the cloud and roof sit on it */
export function siteTop(floors: number): number {
  return BASE_H + floors * FLOOR_H;
}

export function Site() {
  const look = useLook();
  const tl = useStore((s) => s.timeline);
  const t = useStore((s) => s.uiT);
  if (tl.foundationAt === null || t < tl.foundationAt) return null;
  const floors = floorsAt(tl, t);
  const top = siteTop(floors.length);
  const roofed = tl.roofAt !== null && t >= tl.roofAt;
  const smoke = activeAt(tl.smoke, t);
  const cloud = activeAt(tl.clouds, t);
  return (
    <group position={[SITE.x, 0, SITE.z]}>
      <group {...hoverHandlers({ kind: "site" })}>
        <Block size={[3.3, BASE_H, 3.3]} at={[0, BASE_H / 2, 0]} color="#b9b1a6" />
        {/* corner posts: a site under construction until it is roofed */}
        {!roofed
          ? [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]].map(([x, z]) => (
              <mesh key={`${x}${z}`} position={[x, BASE_H + (top - BASE_H) / 2 + 0.35, z]} castShadow>
                <boxGeometry args={[0.1, top - BASE_H + 0.7, 0.1]} />
                <Mat color={look.wood} />
              </mesh>
            ))
          : null}
        {floors.map((f, i) => (
          <Block key={f.eventId} size={[2.6, FLOOR_H * 0.9, 2.6]} at={[0, BASE_H + FLOOR_H * (i + 0.5), 0]} color={f.kind === "main" ? MAIN_FLOOR : SUBAGENT} />
        ))}
        {roofed ? (
          <group position={[0, top, 0]}>
            <mesh position={[0, 0.5, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[2.1, 1, 4]} />
              <Mat color={look.roof} />
            </mesh>
            <mesh position={[0, 1.6, 0]}><cylinderGeometry args={[0.04, 0.04, 1.4, 6]} /><meshStandardMaterial color="#333" /></mesh>
            <mesh position={[0.3, 2.05, 0]}><boxGeometry args={[0.6, 0.35, 0.02]} /><meshStandardMaterial color="#16a34a" /></mesh>
          </group>
        ) : null}
        {/* hit box over the whole stack */}
        <mesh position={[0, (top + 1) / 2, 0]} visible={false}><boxGeometry args={[3.2, top + 1, 3.2]} /></mesh>
      </group>
      {smoke ? <Smoke y={top} /> : null}
      {cloud ? (
        <group position={[0, top + 2.4 + (roofed ? 1.2 : 0), 0]}>
          <Cloud />
        </group>
      ) : null}
    </group>
  );
}

function Smoke({ y }: { y: number }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const p = (clock.elapsedTime * 0.5 + i / g.children.length) % 1;
      c.position.set(Math.sin(i * 2.1) * 0.5 + p * 0.3, y + p * 2.2, Math.cos(i * 1.7) * 0.5);
      c.scale.setScalar(0.25 + p * 0.45);
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i}><sphereGeometry args={[0.5, 8, 6]} /><meshStandardMaterial color="#6b7280" transparent opacity={0.55} /></mesh>
      ))}
    </group>
  );
}

function Cloud() {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = Math.sin(clock.elapsedTime * 1.4) * 0.08;
  });
  const puffs: [number, number, number, number][] = [[0, 0, 0, 0.75], [-0.75, -0.1, 0.1, 0.55], [0.75, -0.1, -0.1, 0.6], [0.3, 0.3, 0.3, 0.5], [-0.3, 0.25, -0.3, 0.5]];
  return (
    <group ref={ref}>
      {puffs.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}><sphereGeometry args={[r, 12, 8]} /><meshStandardMaterial color="#374151" /></mesh>
      ))}
    </group>
  );
}

/** dashed frames beside the site, one per subagent; each grows a level per edit and merges on return */
export function Scaffolds() {
  const tl = useStore((s) => s.timeline);
  const t = useStore((s) => s.uiT);
  return (
    <group>
      {tl.scaffolds
        .filter((sc) => t >= sc.appear && (sc.merge === null || t < sc.merge))
        .map((sc) => {
          const levels = sc.floors.filter((f) => f <= t).length;
          const h = 0.8 + levels * FLOOR_H;
          const w = 0.75;
          const pts = (y: number): [number, number, number][] => [[-w, y, -w], [w, y, -w], [w, y, w], [-w, y, w], [-w, y, -w]];
          return (
            <group key={sc.agentId} position={[sc.pos.x, 0, sc.pos.z]} {...hoverHandlers({ kind: "scaffold", agentId: sc.agentId })}>
              <Line points={pts(0.02)} color={SUBAGENT} lineWidth={2} dashed dashSize={0.2} gapSize={0.12} />
              <Line points={pts(h)} color={SUBAGENT} lineWidth={2} dashed dashSize={0.2} gapSize={0.12} />
              {[[-w, -w], [w, -w], [w, w], [-w, w]].map(([x, z]) => (
                <Line key={`${x}${z}`} points={[[x, 0, z], [x, h, z]]} color={SUBAGENT} lineWidth={2} dashed dashSize={0.2} gapSize={0.12} />
              ))}
              {Array.from({ length: levels }, (_, i) => (
                <mesh key={i} position={[0, FLOOR_H * (i + 0.5), 0]}>
                  <boxGeometry args={[w * 1.7, FLOOR_H * 0.9, w * 1.7]} />
                  <meshStandardMaterial color={SUBAGENT} transparent opacity={0.75} />
                </mesh>
              ))}
              <mesh position={[0, h / 2, 0]} visible={false}><boxGeometry args={[w * 2, h, w * 2]} /></mesh>
            </group>
          );
        })}
    </group>
  );
}
