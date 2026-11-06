// The city drawn with the Blender kit (D19, D20): hex ground tiles by cell kind, the buildings by what
// they stand for, and a living town around them — a fountain and benches on the square, bio-trees and
// rocks on the wild ground, hover cars along the streets, mountains on the horizon.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FACTION_COLOR, type Block, type Planet } from "../galaxy/galaxyData.ts";
import { hash, streetOf, type TownLayout } from "../v3/townLayout.ts";
import { absTime, useStore } from "../store.ts";
import { useReplay } from "./cityReplay.ts";
import { deliveriesAt } from "./deliveries.ts";
import { kitMaterial, KitInstances, useKit, type Kit, type Placement } from "./kit.tsx";

const UP = new THREE.Vector3(0, 1, 0);
/** a hex cell's corner radius: neighbouring cells are 2 apart (townLayout.cellPos) */
export const CELL_R = 2 / Math.sqrt(3);
const TILE: Record<string, string> = { lot: "tile_lot", plaza: "tile_plaza", street: "tile_street", grass: "tile_wild" };
const cellXZ = (q: number, r: number) => ({ x: 2 * (q + r / 2), z: Math.sqrt(3) * r });
const ringOf = (q: number, r: number) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

const place = (x: number, z: number, yaw: number, s: number, sy = s) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(s, sy, s));

/** the kit piece that draws a block; houses have two designs, picked per request */
export function pieceOf(b: Block): string {
  const i = b.spot.info;
  if (i.kind === "house") {
    const tier = b.spot.size >= 1.45 ? "house_l" : b.spot.size >= 1.2 ? "house_m" : "house_s";
    return hash(i.requestId, 21) < 0.5 ? tier : `${tier}_b`;
  }
  if (i.kind === "tent") return "tent";
  if (i.kind === "public") return `work_${i.work}`;
  if (i.kind === "landmark") return `landmark_${i.tier}`;
  if (i.kind === "hall") return "hall";
  return "notice";
}

export function KitGround({ p, layout }: { p: Planet; layout: TownLayout }) {
  const kit = useKit();
  const placements = useMemo(() => {
    const out: Placement[] = [];
    const ground = new THREE.Color(p.look.b).lerp(new THREE.Color("#5a5f6a"), 0.35).multiplyScalar(0.5);
    const fac = new THREE.Color(FACTION_COLOR[p.town.faction]);
    const glow = new THREE.Color(p.look.atmo);
    const maxRing = Math.max(...layout.cells.map((c) => ringOf(c.q, c.r)));
    // the square: fountains on two plaza cells of ring 2, opposite each other
    const plaza2 = layout.cells.filter((c) => c.kind === "plaza" && ringOf(c.q, c.r) === 2);
    const fountains = new Set(plaza2.length ? [plaza2[0], plaza2[Math.floor(plaza2.length / 2)]].map((c) => `${c.q},${c.r}`) : []);
    for (const c of layout.cells) {
      const { x, z } = cellXZ(c.q, c.r);
      const h = hash(`${p.key}|${c.q},${c.r}`, 11);
      const ring = ringOf(c.q, c.r);
      out.push({ piece: TILE[c.kind], matrix: place(x, z, Math.floor(h * 6) * (Math.PI / 3), CELL_R * 0.985), tint: c.kind === "grass" ? ground.clone().multiplyScalar(0.85 + h * 0.3) : fac });
      if (c.kind === "street" && h < 0.55) {
        const a = Math.floor(h * 12) * (Math.PI / 3) + Math.PI / 6;
        out.push({ piece: "lamp", matrix: place(x + Math.cos(a) * 0.74, z + Math.sin(a) * 0.74, -a, 1.3) });
      }
      if (c.kind === "plaza") {
        if (fountains.has(`${c.q},${c.r}`)) out.push({ piece: "fountain", matrix: place(x, z, 0, 1.5), tint: fac });
        else if (h > 0.55 && h < 0.75) out.push({ piece: "bench", matrix: place(x + (h - 0.65) * 3, z + 0.5, h * 9, 1.2) });
        else if (h >= 0.75 && h < 0.85) out.push({ piece: "tree", matrix: place(x, z, h * 7, 1.1 + h * 0.6), tint: glow.clone().multiplyScalar(0.7) });
        else if (h >= 0.92) out.push({ piece: "crates", matrix: place(x + 0.3, z - 0.2, h * 6, 1.1), tint: fac });
      }
      if (c.kind === "grass") {
        const edge = ring >= maxRing - 1;
        if (h < 0.16) out.push({ piece: "rock", matrix: place(x + (h - 0.08) * 4, z, h * 30, 1.1 + h * 3), tint: ground });
        else if (h > 0.62 && h < 0.8 && !edge) out.push({ piece: "tree", matrix: place(x + (h - 0.7) * 5, z - (h - 0.7) * 4, h * 11, 1.2 + h * 0.6), tint: glow.clone().multiplyScalar(0.7) });
        else if (h > 0.93) out.push({ piece: "crystal", matrix: place(x, z, h * 9, 1.1 + h), tint: glow });
      }
    }
    // mountains on the horizon, in two broken rings
    const R = layout.radius;
    for (let i = 0; i < 34; i++) {
      const u = hash(`${p.key}|m${i}`, 31), v = hash(`${p.key}|m${i}`, 32), w = hash(`${p.key}|m${i}`, 33);
      const a = (i / 34) * Math.PI * 2 + u * 0.3;
      const d = R * (3.2 + (i % 2) * 1.1 + v * 0.8);
      const s = R * (0.16 + w * 0.22);
      out.push({ piece: "mountain", matrix: place(Math.cos(a) * d, Math.sin(a) * d, u * 6, s, s * (0.55 + v * 0.6)), tint: ground.clone().multiplyScalar(0.7 + w * 0.3) });
    }
    return out;
  }, [p, layout]);
  return <KitInstances kit={kit} placements={placements} town={p.key} />;
}

export function KitBuildings({ p, vis }: { p: Planet; vis: Block[] }) {
  const kit = useKit();
  const placements = useMemo(
    () =>
      vis.map((b): Placement => {
        const x = b.spot.x, z = b.spot.z;
        // doors face the square
        const yaw = Math.hypot(x, z) < 1e-6 ? 0 : Math.atan2(-x, -z);
        const k = b.type === "notice" ? 1.4 : 1;
        return { piece: pieceOf(b), matrix: place(x, z, yaw, (b.foot / p.unit) * k), tint: new THREE.Color(b.color), block: b };
      }),
    [vis, p.unit],
  );
  return <KitInstances kit={kit} placements={placements} town={p.key} />;
}

/** cars are deliveries (spec 2026-11-05 D26 A2): a request that just finished with a product drives from
 * the task hall to its house (or its street) on the scene clock — live, or the replayed request at its end */
const MAX_CARS = 8;
export function Deliveries({ p, layout }: { p: Planet; layout: TownLayout }) {
  const kit = useKit();
  const parts = kit.get("hovercar") ?? [];
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const w = useStore((s) => s.w25);
  const mine = useMemo(() => [...(w?.requests.values() ?? [])].filter((r) => `${r.faction}|${r.projectId}` === p.key && r.class === "produced"), [w, p.key]);
  const hall = p.blocks.find((b) => b.type === "hall");
  const houseOf = useMemo(() => new Map(p.blocks.filter((b) => b.spot.info.kind === "house").map((b) => [(b.spot.info as { requestId: string }).requestId, b] as const)), [p.blocks]);
  const tint = useMemo(() => new THREE.Color(FACTION_COLOR[p.town.faction]), [p]);
  useLayoutEffect(() => {
    refs.current.forEach((m, j) => {
      if (!m || parts[j]?.material !== "Accent") return;
      for (let i = 0; i < MAX_CARS; i++) m.setColorAt(i, tint);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }, [parts, tint]);
  const roofSeen = useRef<{ id: string; at: number } | null>(null);
  const tmp = useMemo(() => ({ base: new THREE.Matrix4(), out: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  const targetOf = (requestId: string, topDir: string | null) => {
    const h = houseOf.get(requestId);
    if (h) return { x: h.spot.x, z: h.spot.z };
    const st = layout.streets.find((x) => x.name === streetOf(topDir));
    return st ? { x: st.x, z: st.z } : null;
  };
  useFrame(({ clock }) => {
    if (!hall) return;
    const st = useStore.getState();
    const r = useReplay.getState().r;
    let list: { requestId: string; k: number; fade: number; topDir: string | null }[] = [];
    if (r && r.district === p.key) {
      // a replay: its own request, once its roof is on — timed from that moment on the wall clock, since the
      // replay's clock stops at its end
      const roofed = r.tl.roofAt !== null && r.t >= r.tl.roofAt;
      if (!roofed) roofSeen.current = null;
      else {
        if (roofSeen.current?.id !== r.requestId) roofSeen.current = { id: r.requestId, at: performance.now() };
        const req = w?.requests.get(r.requestId);
        list = deliveriesAt([{ requestId: r.requestId, endTs: roofSeen.current.at, class: req?.class ?? "produced" }], performance.now()).map((d) => ({ ...d, topDir: req?.topDir ?? null }));
      }
    } else if (st.historyAt === null) {
      const now = absTime(st.t);
      list = deliveriesAt(mine, now).map((d) => ({ ...d, topDir: w?.requests.get(d.requestId)?.topDir ?? null }));
    }
    let n = 0;
    for (const d of list.slice(-MAX_CARS)) {
      const to = targetOf(d.requestId, d.topDir);
      if (!to) continue;
      const e = d.k * d.k * (3 - 2 * d.k);
      const x = hall.spot.x + (to.x - hall.spot.x) * e, z = hall.spot.z + (to.z - hall.spot.z) * e;
      const y = 0.35 + Math.sin(Math.PI * d.k) * 1.2 + Math.sin(clock.elapsedTime * 3 + n) * 0.03;
      tmp.q.setFromAxisAngle(UP, Math.atan2(to.x - hall.spot.x, to.z - hall.spot.z));
      tmp.base.compose(tmp.v.set(x, y, z), tmp.q, tmp.s.setScalar(1.6 * Math.max(0.05, d.fade)));
      refs.current.forEach((m, j) => m && m.setMatrixAt(n, tmp.out.multiplyMatrices(tmp.base, parts[j].local)));
      n++;
    }
    refs.current.forEach((m) => {
      if (!m) return;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    });
  });
  if (!parts.length || !hall) return null;
  return (
    <>
      {parts.map((part, j) => (
        <instancedMesh key={j} ref={(m) => { refs.current[j] = m; }} args={[part.geometry, kitMaterial(part.material), MAX_CARS]} castShadow frustumCulled={false} raycast={() => null} />
      ))}
    </>
  );
}

/** a soft studio reflection for metal and glass, made locally (no download) */
export function StudioEnvironment({ intensity = 0.55 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    scene.environment = tex;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      tex.dispose();
      pmrem.dispose();
      room.dispose?.();
    };
  }, [gl, scene, intensity]);
  return null;
}

/** a haze in the planet's colour: depth for the buildings, the horizon fading into the sky */
export function Haze({ p, layout }: { p: Planet; layout: TownLayout }) {
  const { scene } = useThree();
  useEffect(() => {
    const c = new THREE.Color(p.look.atmo).lerp(new THREE.Color("#05070d"), 0.82);
    scene.fog = new THREE.FogExp2(c, 0.55 / (layout.radius * 4));
    return () => { scene.fog = null; };
  }, [scene, p, layout]);
  return null;
}

export type { Kit };
