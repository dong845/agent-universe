// The world around the districts: a continent split by a river into the two faction territories,
// the sea, mountains along the north, forest between towns, roads from each faction's capital to its
// towns, bridges for cross-faction hand-overs, the houses of finished tasks, and simplified massing
// for towns seen from far away. Everything large is instanced to keep draw calls low.
import { useMemo, useRef } from "react";
import { Color, ExtrudeGeometry, Object3D, Shape, type InstancedMesh, type Mesh } from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { Faction } from "../../../schema/src/event.ts";
import { BUILDINGS } from "../../../schema/src/world.ts";
import { BUILDING_POS, HALL_BUILDING, type Vec } from "../orchestrator/layout.ts";
import { riverX, type District, type World as WorldT } from "../orchestrator/worldgen.ts";
import { useStore } from "../store.ts";
import { Block } from "./Buildings.tsx";
import { DistrictContext } from "./districtContext.tsx";
import { hoverHandlers, selectOnClick } from "./hover.ts";
import { LOOKS } from "./looks.ts";
import { Mat } from "./Mat.tsx";

const RIVER_HALF = 3.2;
const SEA = "#8fd0dc";
const look = LOOKS.toy;

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** one bank of the continent: from the river's edge out to a rounded coast */
function territoryShape(side: -1 | 1, w: WorldT): Shape {
  const { minZ, maxZ } = w.bounds;
  const outer = side * (w.bounds.maxX - 7);
  const r = 14; // corner radius
  const pts: [number, number][] = [];
  // river bank, north → south
  for (let z = minZ + 6; z <= maxZ - 6; z += 4) pts.push([riverX(z) + side * RIVER_HALF, z]);
  // south coast with a rounded outer corner
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push([outer - side * r + side * Math.sin(a) * r, maxZ - r + Math.cos(a) * r]);
  }
  // north coast
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push([outer - side * r + side * Math.cos(a) * r, minZ + r - Math.sin(a) * r]);
  }
  // shape space y = −world z (the mesh is rotated −90° about x)
  const s = new Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
}

function Territory({ side, faction }: { side: -1 | 1; faction: Faction }) {
  const w = useStore((s) => s.world);
  const geo = useMemo(() => {
    const g = new ExtrudeGeometry(territoryShape(side, w), { depth: 3, bevelEnabled: true, bevelSize: 0.8, bevelThickness: 0.6, bevelSegments: 3, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -3.6, 0);
    return g;
  }, [side, w]);
  const grass = faction === "codex" ? "#9fd0b4" : look.ground.top;
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial attach="material-0" color={grass} roughness={0.9} />
      <meshStandardMaterial attach="material-1" color={look.ground.soil} roughness={1} />
    </mesh>
  );
}

function Sea() {
  const b = useStore((s) => s.world.bounds);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, (b.minZ + b.maxZ) / 2]} receiveShadow>
      <planeGeometry args={[(b.maxX - b.minX) * 2.2, (b.maxZ - b.minZ) * 2.4]} />
      <meshStandardMaterial color={SEA} roughness={0.35} metalness={0.05} />
    </mesh>
  );
}

function instancer<T>(items: T[], place: (o: Object3D, it: T, i: number) => void, color?: (it: T, i: number) => Color) {
  return (m: InstancedMesh | null) => {
    if (!m) return;
    const o = new Object3D();
    items.forEach((it, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      place(o, it, i);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (color) m.setColorAt(i, color(it, i));
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  };
}

function Mountains() {
  const w = useStore((s) => s.world);
  const peaks = useMemo(() => {
    const r = rand(5);
    const out: { x: number; z: number; h: number; s: number }[] = [];
    for (let x = -(w.bounds.maxX - 15); x <= w.bounds.maxX - 15; x += 7) {
      if (Math.abs(x - riverX(w.bounds.minZ + 10)) < 9) continue;
      for (let k = 0; k < 2; k++) out.push({ x: x + r() * 5, z: w.bounds.minZ + 8 + r() * 12 + k * 6, h: 5 + r() * 9, s: 4 + r() * 3 });
    }
    return out;
  }, [w]);
  return (
    <group>
      <instancedMesh ref={instancer(peaks, (o, p) => { o.position.set(p.x, p.h / 2 - 0.6, p.z); o.scale.set(p.s, p.h, p.s); })} args={[undefined, undefined, peaks.length]} castShadow receiveShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#a89a8a" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={instancer(peaks, (o, p) => { o.position.set(p.x, p.h - 0.6 - p.h * 0.14, p.z); o.scale.set(p.s * 0.3, p.h * 0.3, p.s * 0.3); })} args={[undefined, undefined, peaks.length]}>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#fbfbf7" roughness={0.8} flatShading />
      </instancedMesh>
    </group>
  );
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** the end of a district's road: just outside its front, on the hall side */
export function districtGate(d: District): Vec {
  return { x: d.origin.x + HALL_BUILDING.x, z: d.origin.z + d.radius + 1 };
}

function roadSegments(w: WorldT): [Vec, Vec][] {
  const segs: [Vec, Vec][] = [];
  for (const d of w.districts) {
    const cap = w.capitals[d.faction];
    const gate = districtGate(d);
    const bend = { x: cap.x, z: gate.z + 6 };
    segs.push([cap, bend], [bend, { x: gate.x, z: bend.z }], [{ x: gate.x, z: bend.z }, gate]);
  }
  return segs;
}

function Forest() {
  const w = useStore((s) => s.world);
  const trees = useMemo(() => {
    const r = rand(17);
    const segs = roadSegments(w);
    const out: { x: number; z: number; s: number; c: number; codex: boolean }[] = [];
    const ok = (x: number, z: number) =>
      Math.abs(x - riverX(z)) > RIVER_HALF + 3 &&
      Math.abs(x) < w.bounds.maxX - 13 && z > w.bounds.minZ + 26 && z < w.bounds.maxZ - 6 &&
      w.districts.every((d) => Math.hypot(d.origin.x - x, d.origin.z - z) > d.radius + 2.5) &&
      Object.values(w.capitals).every((c) => Math.hypot(c.x - x, c.z - z) > 11) &&
      segs.every(([a, b]) => distToSegment({ x, z }, a, b) > 2.2);
    // clustered: pick grove centres, then trees around them
    // 70 groves on the demo's 270 × 213 continent, scaled by area
    const groves = Math.round((70 * (w.bounds.maxX - w.bounds.minX) * (w.bounds.maxZ - w.bounds.minZ)) / (270 * 213));
    for (let g = 0; g < groves; g++) {
      const cx = (r() * 2 - 1) * (w.bounds.maxX - 15);
      const cz = w.bounds.minZ + 26 + r() * (w.bounds.maxZ - w.bounds.minZ - 32);
      const n = 6 + Math.floor(r() * 14);
      for (let i = 0; i < n; i++) {
        const x = cx + (r() * 2 - 1) * 9;
        const z = cz + (r() * 2 - 1) * 9;
        if (ok(x, z) && out.every((o) => Math.hypot(o.x - x, o.z - z) > 1.6)) out.push({ x, z, s: 0.8 + r() * 0.7, c: Math.floor(r() * 4), codex: x > riverX(z) });
      }
    }
    return out;
  }, [w]);
  const warm = look.foliage.map((c) => new Color(c));
  const cool = ["#6fae8f", "#82bfa0", "#5d9c80", "#9cc9b0"].map((c) => new Color(c));
  return (
    <group>
      <instancedMesh ref={instancer(trees, (o, p) => { o.position.set(p.x, 0.4 * p.s, p.z); o.scale.setScalar(p.s); })} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.14, 0.18, 0.8, 6]} />
        <meshStandardMaterial color={look.trunk} roughness={1} />
      </instancedMesh>
      <instancedMesh
        ref={instancer(trees, (o, p) => { o.position.set(p.x, 1.25 * p.s, p.z); o.scale.setScalar(p.s); }, (p) => (p.codex ? cool : warm)[p.c % 4])}
        args={[undefined, undefined, trees.length]}
        castShadow
        receiveShadow
      >
        <icosahedronGeometry args={[0.9, 1]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </group>
  );
}

function Roads() {
  const w = useStore((s) => s.world);
  const segs = useMemo(() => roadSegments(w), [w]);
  return (
    <instancedMesh
      ref={instancer(segs, (o, [a, b]) => {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        o.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2);
        o.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
        o.scale.set(1.8, 0.05, len + 1.8);
      })}
      args={[undefined, undefined, segs.length]}
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={look.ground.path} roughness={1} />
    </instancedMesh>
  );
}

function Capital({ faction }: { faction: Faction }) {
  const at = useStore((s) => s.world.capitals[faction]);
  const roof = faction === "codex" ? "#4f86b8" : look.roof;
  const wall = faction === "codex" ? "#e6eef5" : look.hall.wall;
  return (
    <DistrictContext.Provider value={null}>
      <group position={[at.x, 0, at.z]} rotation={[0, Math.PI / 4, 0]} scale={1.6} {...hoverHandlers({ kind: "faction", faction })}>
        <Block size={[11, 0.4, 7]} at={[0, 0.2, 0]} color={look.ground.plaza} cast={false} />
        <Block size={[7, 3.4, 4]} at={[0, 2.1, 0]} color={wall} />
        <mesh position={[0, 4.6, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[4.6, 2.4, 4]} /><Mat color={roof} /></mesh>
        {[-4.2, 4.2].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh position={[0, 2.6, 0]} castShadow><cylinderGeometry args={[1, 1, 5.2, 12]} /><Mat color={wall} /></mesh>
            <mesh position={[0, 5.9, 0]} castShadow><coneGeometry args={[1.3, 1.6, 12]} /><Mat color={roof} /></mesh>
          </group>
        ))}
        <mesh position={[0, 1.4, 2.05]}><boxGeometry args={[1.6, 2.2, 0.1]} /><Mat color="#5b3a29" /></mesh>
        <mesh position={[0, 7.4, 0]}><cylinderGeometry args={[0.08, 0.08, 2.2, 6]} /><Mat color="#333333" /></mesh>
        <mesh position={[0.6, 8.1, 0]}><boxGeometry args={[1.2, 0.7, 0.05]} /><Mat color={roof} /></mesh>
      </group>
    </DistrictContext.Provider>
  );
}

/** an arched wooden bridge across the river on a shared project's row, standing from its first crossing */
function Bridges() {
  const w = useStore((s) => s.world);
  const t0 = useStore((s) => s.t0);
  const t = useStore((s) => s.uiT);
  return (
    <group>
      {w.bridges.filter((b) => b.at <= t0 + t).map((b) => {
        const z = b.a.z;
        const cx = riverX(z);
        const planks = Array.from({ length: 13 }, (_, i) => i / 12);
        return (
          <group key={b.districts.join()}>
            {planks.map((f) => {
              const x = cx - 5 + f * 10;
              const y = Math.sin(f * Math.PI) * 1.1 + 0.15;
              return (
                <mesh key={f} position={[x, y, z]} rotation={[0, 0, -Math.cos(f * Math.PI) * 0.33]} castShadow>
                  <boxGeometry args={[0.85, 0.14, 2.4]} />
                  <Mat color={look.wood} />
                </mesh>
              );
            })}
            {[-1.15, 1.15].map((dz) => (
              <mesh key={dz} position={[cx, 1.75, z + dz]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[5.1, 0.07, 6, 24, Math.PI]} />
                <Mat color="#6b4430" />
              </mesh>
            ))}
            {/* approach roads from each town's side to the bridge ends */}
            {[b.a, b.b].map((p, i) => {
              const end = { x: cx + (p.x < cx ? -5 : 5), z };
              const len = Math.abs(p.x - end.x);
              return (
                <mesh key={i} position={[(p.x + end.x) / 2, 0.025, z]} receiveShadow>
                  <boxGeometry args={[len, 0.05, 1.6]} />
                  <Mat color={look.ground.path} />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Finished tasks: one house each, height = task size, roof colour = result, a flag when it
 * succeeded. Instances are written once, sorted by completion time; playback only changes how many
 * are drawn (no React re-render, no rewrite of the instance buffers).
 */
function Houses() {
  const w = useStore((s) => s.world);
  const all = useMemo(() => w.districts.flatMap((d) => d.houses.map((h) => ({ h, d }))).sort((a, b) => a.h.builtAt - b.h.builtAt), [w]);
  const flagged = useMemo(() => all.filter((x) => x.h.ok === true), [all]);
  const body = useRef<InstancedMesh>(null);
  const roofM = useRef<InstancedMesh>(null);
  const flag = useRef<InstancedMesh>(null);
  useFrame(() => {
    const now = useStore.getState().t0 + useStore.getState().t;
    const n = upTo(all, now);
    if (body.current) body.current.count = n;
    if (roofM.current) roofM.current.count = n;
    if (flag.current) flag.current.count = upTo(flagged, now);
  });
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const it = e.instanceId !== undefined ? all[e.instanceId] : undefined;
    if (it) hoverHandlers({ kind: "house", district: it.d.key, taskId: it.h.taskId }).onPointerOver(e);
  };
  const onOut = () => {
    const h = useStore.getState().hovered;
    if (h?.kind === "house") useStore.getState().setHovered(null);
    document.body.style.cursor = "";
  };
  const wall = (f: Faction) => new Color(f === "codex" ? "#e8eef3" : "#fbefd9");
  // grey only for a recorded failure; a task that never ended keeps its faction's roof, with no flag
  const roof = (f: Faction, ok: boolean | null) => new Color(ok === false ? "#7a7470" : f === "codex" ? "#4f86b8" : look.roof);
  const height = (floors: number) => 0.6 + floors * 0.42;
  const face = (o: Object3D, it: { h: { at: Vec }; d: District }) => o.rotation.set(0, Math.atan2(it.d.origin.x - it.h.at.x, it.d.origin.z - it.h.at.z), 0);
  const both = (ref: { current: InstancedMesh | null }, fill: (m: InstancedMesh | null) => void) => (m: InstancedMesh | null) => {
    ref.current = m;
    fill(m);
  };
  const n = Math.max(1, all.length);
  return (
    <group>
      <instancedMesh
        ref={both(body, instancer(all, (o, it) => { o.position.set(it.h.at.x, height(it.h.floors) / 2, it.h.at.z); face(o, it); o.scale.set(1.5, height(it.h.floors), 1.3); }, (it) => wall(it.d.faction)))}
        args={[undefined, undefined, n]}
        castShadow
        receiveShadow
        onPointerOver={onOver}
        onPointerOut={onOut}
        onClick={selectOnClick((e) => {
          const it = e.instanceId !== undefined ? all[e.instanceId] : undefined;
          return it ? { kind: "task", district: it.d.key, taskId: it.h.taskId } : null;
        })}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh
        ref={both(roofM, instancer(all, (o, it) => { o.position.set(it.h.at.x, height(it.h.floors) + 0.38, it.h.at.z); face(o, it); o.rotateY(Math.PI / 4); o.scale.set(1.25, 0.75, 1.25); }, (it) => roof(it.d.faction, it.h.ok)))}
        args={[undefined, undefined, n]}
        castShadow
      >
        <coneGeometry args={[1, 1, 4]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh
        ref={both(flag, instancer(flagged, (o, it) => { o.position.set(it.h.at.x + 0.25, height(it.h.floors) + 1.05, it.h.at.z); o.scale.set(0.34, 0.2, 0.02); }))}
        args={[undefined, undefined, Math.max(1, flagged.length)]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#22c55e" roughness={0.6} />
      </instancedMesh>
    </group>
  );
}

/** how many items (sorted by builtAt) are built by `now` */
function upTo(items: { h: { builtAt: number } }[], now: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].h.builtAt <= now) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** towns seen from afar: the nine buildings as simple massing, all towns in two draw calls */
export function LiteTowns({ keys }: { keys: Set<string> }) {
  const w = useStore((s) => s.world);
  const items = useMemo(
    () => w.districts.filter((d) => !keys.has(d.key)).flatMap((d) => BUILDINGS.map((b) => ({ d, b, p: BUILDING_POS[b.id] }))),
    [w, keys],
  );
  // each far town's landmark: its plaza and a clock tower, taller with every tier
  const towns = useMemo(() => w.districts.filter((d) => !keys.has(d.key)), [w, keys]);
  const wallOf = (d: District, id: string) => new Color(d.faction === "codex" ? "#dfe7ee" : (look.building as Record<string, { wall: string }>)[id].wall);
  return (
    <group>
      <instancedMesh key={`lb${items.length}`} ref={instancer(items, (o, it) => { o.position.set(it.d.origin.x + it.p.x, 0.75, it.d.origin.z + it.p.z); o.rotation.set(0, Math.atan2(-it.p.x, -it.p.z), 0); o.scale.set(2.2, 1.5, 1.7); }, (it) => wallOf(it.d, it.b.id))} args={[undefined, undefined, Math.max(1, items.length)]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh key={`lr${items.length}`} ref={instancer(items, (o, it) => { o.position.set(it.d.origin.x + it.p.x, 1.95, it.d.origin.z + it.p.z); o.rotation.set(0, Math.atan2(-it.p.x, -it.p.z) + Math.PI / 4, 0); o.scale.set(1.7, 0.9, 1.7); }, (it) => new Color(it.d.faction === "codex" ? "#4f86b8" : look.roof))} args={[undefined, undefined, Math.max(1, items.length)]} castShadow>
        <coneGeometry args={[1, 1, 4]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh key={`lp${towns.length}`} ref={instancer(towns, (o, d) => { o.position.set(d.origin.x, 0.05, d.origin.z + 0.6); o.scale.set(5.4, 0.1, 5.4); }, (d) => new Color(d.faction === "codex" ? "#d5dde3" : look.ground.plaza))} args={[undefined, undefined, Math.max(1, towns.length)]} receiveShadow>
        <cylinderGeometry args={[1, 1, 1, 40]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh key={`lt${towns.length}`} ref={instancer(towns, (o, d) => { const h = 2.5 + d.tier * 1.1; o.position.set(d.origin.x, h / 2, d.origin.z); o.scale.set(1.5, h, 1.5); }, (d) => new Color(d.faction === "codex" ? "#e6eef5" : look.hall.wall))} args={[undefined, undefined, Math.max(1, towns.length)]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh key={`ls${towns.length}`} ref={instancer(towns, (o, d) => { const h = 2.5 + d.tier * 1.1; o.position.set(d.origin.x, h + 0.9, d.origin.z); o.rotation.set(0, Math.PI / 4, 0); o.scale.set(1.35, 1.8, 1.35); }, (d) => new Color(d.faction === "codex" ? "#4f86b8" : look.roof))} args={[undefined, undefined, Math.max(1, towns.length)]} castShadow>
        <coneGeometry args={[1, 1, 4]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </group>
  );
}

/** a district's footprint, wall and towers by tier, and the double-click target to fly in */
export function TownBounds() {
  const w = useStore((s) => s.world);
  return (
    <group>
      {w.districts.map((d) => {
        const wallR = d.radius + 0.3;
        const roof = d.faction === "codex" ? "#4f86b8" : look.roof;
        return (
          <group key={d.key} position={[d.origin.x, 0, d.origin.z]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.004, 0]}
              receiveShadow
              onDoubleClick={(e) => {
                e.stopPropagation();
                useStore.getState().setFocus(d.key);
              }}
              {...hoverHandlers({ kind: "district", district: d.key })}
            >
              <circleGeometry args={[d.radius + 1.2, 64]} />
              <meshStandardMaterial color={d.faction === "codex" ? "#bfdcc9" : "#c5d9a0"} roughness={1} />
            </mesh>
            {d.tier >= 3 ? (
              // a low town wall from tier 3, open toward the camera where the road comes in
              <mesh position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, (150 * Math.PI) / 180]} castShadow>
                <torusGeometry args={[wallR, 0.35, 6, 72, (300 * Math.PI) / 180]} />
                <meshStandardMaterial color="#d8c8b0" roughness={1} />
              </mesh>
            ) : null}
            {d.tier >= 5
              ? [200, 260, 320, 20].map((deg) => {
                  const a = (deg * Math.PI) / 180;
                  return (
                    <group key={deg} position={[Math.cos(a) * wallR, 0, Math.sin(a) * wallR]}>
                      <mesh position={[0, 1.4, 0]} castShadow><cylinderGeometry args={[0.8, 0.9, 2.8, 10]} /><meshStandardMaterial color="#d8c8b0" roughness={1} /></mesh>
                      <mesh position={[0, 3.2, 0]} castShadow><coneGeometry args={[1.05, 1.1, 10]} /><meshStandardMaterial color={roof} roughness={0.8} /></mesh>
                    </group>
                  );
                })
              : null}
          </group>
        );
      })}
    </group>
  );
}

/** a ring on the ground around the selected task's house */
function SelectedMarker() {
  const sel = useStore((s) => s.selected);
  const w = useStore((s) => s.world);
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.06);
  });
  if (sel?.kind !== "task") return null;
  const h = w.districts.find((d) => d.key === sel.district)?.houses.find((x) => x.taskId === sel.taskId);
  if (!h) return null;
  return (
    <mesh ref={ring} position={[h.at.x, 0.06, h.at.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.3, 1.7, 40]} />
      <meshBasicMaterial color="#d4663f" transparent opacity={0.9} />
    </mesh>
  );
}

export function WorldScenery() {
  return (
    <group>
      <Sea />
      <Territory side={-1} faction="claude-code" />
      <Territory side={1} faction="codex" />
      <Mountains />
      <Forest />
      <Roads />
      <Capital faction="claude-code" />
      <Capital faction="codex" />
      <Bridges />
      <TownBounds />
      <Houses />
      <SelectedMarker />
    </group>
  );
}
