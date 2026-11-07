// Suburbs (spec 2026-11-07 D27 C): every finished piece the city does not draw as a house stands as a tiny
// house on the outskirts — walls and a roof in the colour of what it made — so a town's real size shows.
// Two instanced meshes whatever the count; a tiny house appears when its work finished (history and
// replays grow the suburbs too); hover and click work as on a house.
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { PRODUCT_COLOR } from "../galaxy/galaxyData.ts";
import { absTime, useStore } from "../store.ts";
import type { Spot, Suburb, TownLayout } from "../v3/townLayout.ts";

const W = 0.36, H = 0.24, ROOF = 0.24;
const walls = new THREE.BoxGeometry(W, H, W * 0.86).translate(0, H / 2, 0);
const roof = new THREE.ConeGeometry(W * 0.78, ROOF, 4, 1).rotateY(Math.PI / 4).translate(0, H + ROOF / 2, 0);
const wallMat = new THREE.MeshStandardMaterial({ color: "#e9e2d2", roughness: 0.85 });
const roofMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 });

/** how many tiny houses stand at time ts (they are sorted by finish time) */
export function suburbsAt(list: readonly Pick<Suburb, "from">[], ts: number): number {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].from <= ts) lo = m + 1; else hi = m; }
  return lo;
}

export function Suburbs({ town, layout }: { town: string; layout: TownLayout }) {
  const list = layout.suburbs;
  const n = useStore((s) => suburbsAt(list, absTime(s.uiT)));
  const wallRef = useRef<THREE.InstancedMesh>(null);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  // a house-like spot per tiny house, for the hover card and the click (made once per layout)
  const spots = useMemo<Spot[]>(() => list.map((s) => ({ art: { category: "house", theme: "", kind: s.kind, variant: "a" }, x: s.x, z: s.z, size: 0.4, cell: s.cell, info: { kind: "house", requestId: s.requestId }, from: s.from })), [list]);
  useLayoutEffect(() => {
    const w = wallRef.current, r = roofRef.current;
    if (!w || !r) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    list.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 0, s.z), q.setFromAxisAngle(up, s.rot), one);
      w.setMatrixAt(i, m);
      r.setMatrixAt(i, m);
      r.setColorAt(i, c.set(PRODUCT_COLOR[s.kind] ?? "#9aa6b8"));
    });
    w.instanceMatrix.needsUpdate = true;
    r.instanceMatrix.needsUpdate = true;
    if (r.instanceColor) r.instanceColor.needsUpdate = true;
    w.computeBoundingSphere();
    r.computeBoundingSphere();
  }, [list]);
  useLayoutEffect(() => {
    if (wallRef.current) wallRef.current.count = n;
    if (roofRef.current) roofRef.current.count = n;
  }, [n]);
  if (!list.length) return null;
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined || !spots[e.instanceId]) return;
    e.stopPropagation();
    const st = useStore.getState();
    const spot = spots[e.instanceId];
    if (st.hovered?.kind !== "spot" || st.hovered.spot !== spot) st.setHovered({ kind: "spot", district: town, spot });
    document.body.style.cursor = "pointer";
  };
  const leave = () => { useStore.getState().setHovered(null); document.body.style.cursor = ""; };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5 || e.instanceId === undefined || !list[e.instanceId]) return;
    e.stopPropagation();
    useStore.getState().select({ kind: "request", district: town, requestId: list[e.instanceId].requestId });
  };
  return (
    <group>
      <instancedMesh ref={wallRef} args={[walls, wallMat, list.length]} castShadow receiveShadow onPointerMove={move} onPointerLeave={leave} onClick={click} />
      <instancedMesh ref={roofRef} args={[roof, roofMat, list.length]} castShadow onPointerMove={move} onPointerLeave={leave} onClick={click} />
    </group>
  );
}
