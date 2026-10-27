// Set dressing for the toy town: grass tufts, flowers, stones, a fence along the hall road and
// lamps around the plaza. Instanced, deterministic, and kept off paths and out of the way of
// buildings so it never hides anything the data shows.
import { useMemo } from "react";
import { Color, Object3D, type InstancedMesh } from "three";
import { BUILDINGS } from "../../../schema/src/world.ts";
import { BUILDING_POS, HALL, HALL_BUILDING, SITE, WAREHOUSE, doorOf, type Vec } from "../orchestrator/layout.ts";
import { useLook } from "./looks.ts";
import { Mat } from "./Mat.tsx";

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** every path segment, so dressing stays off them */
function pathSegments(): [Vec, Vec][] {
  const segs: [Vec, Vec][] = BUILDINGS.map((b) => {
    const p = BUILDING_POS[b.id];
    const d = Math.hypot(p.x, p.z);
    return [{ x: (p.x / d) * 4.6, z: (p.z / d) * 4.6 }, doorOf(b.id)];
  });
  segs.push([SITE, HALL], [SITE, WAREHOUSE], [HALL, HALL_BUILDING]);
  return segs;
}

function free(p: Vec, segs: [Vec, Vec][]): boolean {
  // inside the house ring (worldgen HOUSE_RING), outside the plaza
  if (Math.hypot(p.x, p.z) < 5.8 || Math.hypot(p.x, p.z) > 12) return false;
  if (segs.some(([a, b]) => distToSegment(p, a, b) < 0.9)) return false;
  if (BUILDINGS.some((b) => Math.hypot(BUILDING_POS[b.id].x - p.x, BUILDING_POS[b.id].z - p.z) < 2.0)) return false;
  if (Math.hypot(HALL_BUILDING.x - p.x, HALL_BUILDING.z - p.z) < 2.4) return false;
  return Math.hypot(WAREHOUSE.x - p.x, WAREHOUSE.z - p.z) > 1.8;
}

function scatter(n: number, seed: number): Vec[] {
  const r = rand(seed);
  const segs = pathSegments();
  const out: Vec[] = [];
  for (let i = 0; out.length < n && i < n * 40; i++) {
    const a = r() * Math.PI * 2;
    const d = 5.8 + r() * 6.2;
    const p = { x: Math.cos(a) * d, z: Math.sin(a) * d };
    if (free(p, segs)) out.push(p);
  }
  return out;
}

function useInstances(points: Vec[], place: (o: Object3D, p: Vec, i: number) => void, color?: (i: number) => Color) {
  return (m: InstancedMesh | null) => {
    if (!m) return;
    const o = new Object3D();
    points.forEach((p, i) => {
      o.position.set(p.x, 0, p.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(1);
      place(o, p, i);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (color) m.setColorAt(i, color(i));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
}

export function Dressing() {
  const look = useLook();
  const tufts = useMemo(() => scatter(140, 11), []);
  const flowers = useMemo(() => scatter(70, 23), []);
  const stones = useMemo(() => scatter(18, 37), []);
  const lamps = useMemo(() => [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    return { x: Math.cos(a) * 5.6, z: Math.sin(a) * 5.6 + 0.6 };
  }).filter((p) => pathSegments().every(([a, b]) => distToSegment(p, a, b) > 0.7)), []);
  const fence = useMemo(() => {
    // posts along both sides of the road from the plaza to the hall
    const out: Vec[] = [];
    for (let z = 6.2; z <= 10.6; z += 1.1) for (const side of [-1.15, 1.15]) out.push({ x: 0.3 + side + z * 0.04, z });
    return out;
  }, []);
  const greens = look.foliage.map((c) => new Color(c));
  const petals = ["#ffffff", "#ffd166", "#f78fb3", "#c3a6ff"].map((c) => new Color(c));
  if (look.id !== "toy") return null;
  return (
    <group>
      <instancedMesh ref={useInstances(tufts, (o, _p, i) => { o.position.y = 0.12; o.rotation.y = i; o.scale.setScalar(0.6 + (i % 5) * 0.12); }, (i) => greens[i % greens.length])} args={[undefined, undefined, tufts.length]} receiveShadow>
        <coneGeometry args={[0.16, 0.36, 5]} />
        <Mat color="#ffffff" />
      </instancedMesh>
      <instancedMesh ref={useInstances(flowers, (o, _p, i) => { o.position.y = 0.16; o.scale.setScalar(0.8 + (i % 3) * 0.2); }, (i) => petals[i % petals.length])} args={[undefined, undefined, flowers.length]}>
        <icosahedronGeometry args={[0.09, 0]} />
        <Mat color="#ffffff" />
      </instancedMesh>
      <instancedMesh ref={useInstances(stones, (o, _p, i) => { o.position.y = 0.08; o.rotation.set(i, i * 2, 0); o.scale.set(0.35 + (i % 4) * 0.08, 0.22, 0.3); })} args={[undefined, undefined, stones.length]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <Mat color="#cbbfae" />
      </instancedMesh>
      <instancedMesh ref={useInstances(fence, (o) => { o.position.y = 0.3; })} args={[undefined, undefined, fence.length]} castShadow>
        <boxGeometry args={[0.1, 0.6, 0.1]} />
        <Mat color={look.wood} />
      </instancedMesh>
      {[-1.15, 1.15].map((side) => (
        <mesh key={side} position={[0.3 + side + 8.4 * 0.04, 0.42, 8.4]} rotation={[0, 0.04, 0]} castShadow>
          <boxGeometry args={[0.06, 0.08, 4.6]} />
          <Mat color={look.wood} />
        </mesh>
      ))}
      {lamps.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.6, 0]} castShadow><cylinderGeometry args={[0.04, 0.05, 1.2, 6]} /><Mat color="#3b2a20" /></mesh>
          <mesh position={[0, 1.25, 0]}><sphereGeometry args={[0.13, 10, 8]} /><Mat color="#fff3c4" emissive="#ffd27a" glow={0.6} /></mesh>
        </group>
      ))}
    </group>
  );
}
