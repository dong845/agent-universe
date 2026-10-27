// The ground the town stands on, the paths between site and buildings, and the trees.
// Paths carry data: each one widens with how often its building has been used so far.
import { useMemo } from "react";
import { Color, CylinderGeometry, Object3D, type InstancedMesh } from "three";
import { keys } from "../../../schema/src/aggregate.ts";
import { BUILDINGS } from "../../../schema/src/world.ts";
import { BUILDING_POS, COMMANDER_POST, HALL, HALL_BUILDING, SITE, WAREHOUSE, doorOf, type Vec } from "../orchestrator/layout.ts";
import { absTime, useStore } from "../store.ts";
import { useLook } from "./looks.ts";
import { Mat } from "./Mat.tsx";

const R = 15;

/** deterministic pseudo-random numbers, so the scenery never shuffles between loads */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** an irregular faceted island: a low-sided cylinder with jittered rim vertices */
function facetedIsland(radius: number, height: number, seed: number): CylinderGeometry {
  const g = new CylinderGeometry(radius, radius * 0.92, height, 11, 1);
  const r = rand(seed);
  const pos = g.attributes.position;
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x, z);
    if (d < 0.01) continue;
    const key = `${Math.atan2(z, x).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.9 + r() * 0.16);
    const f = jitter.get(key)!;
    pos.setX(i, x * f);
    pos.setZ(i, z * f);
  }
  g.computeVertexNormals();
  return g;
}

export function Terrain() {
  const look = useLook();
  const g = look.ground;
  const isle = useMemo(() => facetedIsland(R, 1.2, 7), []);
  if (look.terrain === "board") {
    return (
      <group>
        <mesh position={[0, -0.3, 1]} receiveShadow>
          <boxGeometry args={[34, 0.6, 34]} />
          <Mat color={g.top} />
        </mesh>
        <mesh position={[0, -0.75, 1]}>
          <boxGeometry args={[34.6, 0.4, 34.6]} />
          <Mat color={g.soil} />
        </mesh>
        <Plaza />
        <Paths />
        <Trees />
      </group>
    );
  }
  if (look.terrain === "isle-water") {
    return (
      <group>
        <mesh geometry={isle} position={[0, -0.6, 1]} receiveShadow castShadow>
          <Mat color={g.top} />
        </mesh>
        <mesh position={[0, -2.2, 1]} scale={[0.97, 1, 0.97]}>
          <primitive object={isle} attach="geometry" />
          <Mat color={g.soil} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.15, 1]} receiveShadow>
          <ringGeometry args={[0, 24, 48]} />
          <meshStandardMaterial color={g.water} roughness={0.35} metalness={0.1} flatShading />
        </mesh>
        <Plaza />
        <Paths />
        <Trees />
      </group>
    );
  }
  // floating diorama tile: grass top, two soil layers tapering below
  return (
    <group>
      <mesh position={[0, -0.25, 1]} receiveShadow>
        <cylinderGeometry args={[R, R, 0.5, 72]} />
        <Mat color={g.top} />
      </mesh>
      <mesh position={[0, -1.05, 1]}>
        <cylinderGeometry args={[R - 0.05, R - 0.6, 1.1, 72]} />
        <Mat color={g.soil} />
      </mesh>
      <mesh position={[0, -2.1, 1]}>
        <cylinderGeometry args={[R - 0.6, R - 3.5, 1.0, 72]} />
        <Mat color={g.soilDark} />
      </mesh>
      <Plaza />
      <Paths />
      <Trees />
    </group>
  );
}

function Plaza() {
  const g = useLook().ground;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[SITE.x, 0.012, SITE.z + 0.6]} receiveShadow>
      <circleGeometry args={[5.4, 56]} />
      <Mat color={g.plaza} />
    </mesh>
  );
}

/** a flat strip from a to b */
function Strip({ a, b, width, color }: { a: Vec; b: Vec; width: number; color: string }) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ang = Math.atan2(b.x - a.x, b.z - a.z);
  return (
    <mesh position={[(a.x + b.x) / 2, 0.02, (a.z + b.z) / 2]} rotation={[0, ang, 0]} receiveShadow>
      <boxGeometry args={[width, 0.03, len + width]} />
      <Mat color={color} />
    </mesh>
  );
}

function Paths() {
  const look = useLook();
  const t = useStore((s) => s.uiT);
  const ledger = useStore((s) => s.ledger);
  const project = useStore((s) => s.events[0]?.projectId);
  const abs = absTime(t);
  return (
    <group>
      <Strip a={COMMANDER_POST} b={{ x: HALL.x, z: HALL.z - 0.6 }} width={1.3} color={look.ground.path} />
      <Strip a={SITE} b={WAREHOUSE} width={0.6} color={look.ground.path} />
      <Strip a={HALL} b={HALL_BUILDING} width={0.9} color={look.ground.path} />
      {BUILDINGS.map((b) => {
        // wear: 0.35 wide unused, growing with log2 of the calls so far, up to 1.2
        const calls = project ? ledger.buildingAt(keys.building(project, b.id), abs).calls : 0;
        const width = Math.min(1.2, 0.35 + 0.22 * Math.log2(1 + calls));
        const p = BUILDING_POS[b.id];
        const d = Math.hypot(p.x, p.z);
        const from = { x: (p.x / d) * 4.6, z: (p.z / d) * 4.6 };
        return <Strip key={b.id} a={from} b={doorOf(b.id)} width={width} color={look.ground.path} />;
      })}
    </group>
  );
}

/** trees on the outer ring and in the gaps, two instanced meshes for all of them */
function Trees() {
  const look = useLook();
  const spots = useMemo(() => {
    const r = rand(42);
    const out: { x: number; z: number; s: number; c: number }[] = [];
    // the camera looks from +x,+z: a tree in front of a building (larger x + z, close by) would hide it
    const hides = (x: number, z: number, p: Vec, reach: number) => {
      const dx = x - p.x;
      const dz = z - p.z;
      const along = (dx + dz) / Math.SQRT2; // toward the camera
      const across = Math.abs(dx - dz) / Math.SQRT2;
      return along > -1 && along < reach && across < 2.2;
    };
    const blocked = (x: number, z: number) =>
      Math.hypot(x, z) < 6.2 ||
      BUILDINGS.some((b) => Math.hypot(BUILDING_POS[b.id].x - x, BUILDING_POS[b.id].z - z) < 2.9 || hides(x, z, BUILDING_POS[b.id], 5)) ||
      hides(x, z, HALL_BUILDING, 5) ||
      hides(x, z, WAREHOUSE, 4) ||
      (Math.abs(x - 0.5) < 2.4 && z > 4 && z < 15) || // the hall road
      Math.hypot(x - WAREHOUSE.x, z - WAREHOUSE.z) < 2.4 ||
      Math.hypot(x - HALL_BUILDING.x, z - (HALL_BUILDING.z)) < 3;
    for (let i = 0; out.length < 30 && i < 4000; i++) {
      const a = r() * Math.PI * 2;
      const d = 7 + r() * (R - 8.2);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d + 1;
      if (blocked(x, z) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 1.3)) continue;
      out.push({ x, z, s: 0.6 + r() * 0.45, c: Math.floor(r() * 1000) });
    }
    return out;
  }, []);
  const set = (m: InstancedMesh | null, kind: "trunk" | "crown") => {
    if (!m) return;
    const o = new Object3D();
    spots.forEach((p, i) => {
      if (kind === "trunk") o.position.set(p.x, 0.35 * p.s, p.z);
      else o.position.set(p.x, (look.shading === "toon" ? 0.55 : 1.1) * p.s, p.z);
      o.scale.setScalar(p.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  };
  const crowns = (m: InstancedMesh | null) => {
    set(m, "crown");
    if (!m) return;
    spots.forEach((p, i) => m.setColorAt(i, colorOf(look.foliage[p.c % look.foliage.length])));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  const crownGeo =
    look.shading === "faceted" ? <coneGeometry args={[0.75, 1.6, 6]} /> : look.shading === "toon" ? <sphereGeometry args={[0.6, 14, 10]} /> : <icosahedronGeometry args={[0.8, 1]} />;
  return (
    <group key={look.id}>
      {look.shading === "toon" ? null : (
        <instancedMesh ref={(m) => set(m, "trunk")} args={[undefined, undefined, spots.length]} castShadow>
          <cylinderGeometry args={[0.12, 0.16, 0.7, 6]} />
          <Mat color={look.trunk} />
        </instancedMesh>
      )}
      <instancedMesh ref={crowns} args={[undefined, undefined, spots.length]} castShadow receiveShadow>
        {crownGeo}
        <Mat color="#ffffff" />
      </instancedMesh>
    </group>
  );
}

const colorCache = new Map<string, Color>();
function colorOf(hex: string): Color {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new Color(hex)));
  return c;
}
