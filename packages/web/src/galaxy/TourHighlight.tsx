// What the tour points at, in the 3D scene (spec 2026-11-05 B1): a pulsing ring around the stars, a planet
// or the followed robot, and its point on screen for the tour card; at the end, every planet pulses
// gently until a city is entered.
import { Billboard } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { robotInfo } from "../city/Robot.tsx";
import { useStore } from "../store.ts";
import { useTour } from "../ui/tourStore.ts";
import { spinOf } from "./Galaxy.tsx";
import type { Galaxy } from "./galaxyData.ts";

const RING = new THREE.RingGeometry(0.94, 1, 96);
const mat = () => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffc45c").multiplyScalar(2), transparent: true, opacity: 0.9, toneMapped: false, depthTest: false, side: THREE.DoubleSide });

function Ring({ at, size, faint = false }: { at: () => THREE.Vector3 | null; size: number; faint?: boolean }) {
  const g = useRef<THREE.Group>(null);
  const m = useMemo(mat, []);
  useFrame(({ clock }) => {
    const p = at();
    if (!g.current) return;
    g.current.visible = !!p;
    if (!p) return;
    g.current.position.copy(p);
    const k = 1 + Math.sin(clock.elapsedTime * 3) * 0.08;
    g.current.scale.setScalar(size * k);
    m.opacity = faint ? 0.35 + Math.sin(clock.elapsedTime * 2.2) * 0.2 : 0.9;
  });
  return (
    <group ref={g}>
      <Billboard><mesh geometry={RING} material={m} renderOrder={20} raycast={() => null} /></Billboard>
    </group>
  );
}

const v = new THREE.Vector3();
const planetAt = (key: string) => () => spinOf.get(key)?.getWorldPosition(v) ?? null;

/** in space: the stars, a planet, or (at the end) every planet */
export function TourHighlightSpace({ g }: { g: Galaxy }) {
  const step = useTour((s) => (s.step >= 0 ? s.steps[s.step] : null));
  const invite = useTour((s) => s.invite);
  const { camera, size } = useThree();
  const h = step?.highlight ?? null;
  const target = h?.kind === "planet" ? g.planets.get(h.key) : undefined;
  useFrame(() => {
    if (!h || (h.kind !== "planet" && h.kind !== "star")) return;
    const sys = g.systems[0];
    const p = h.kind === "planet" ? planetAt(h.key)() : new THREE.Vector3(sys?.x ?? 0, 0, sys?.z ?? 0);
    if (!p) return;
    // the ring's size on screen, so the card stands clear of it
    const world = h.kind === "planet" ? (target?.radius ?? 1) * 1.8 : (sys?.radius ?? 1) * 2.2;
    const c = p.clone().project(camera);
    const e = p.clone().add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(world)).project(camera);
    const x = ((c.x + 1) / 2) * size.width, y = ((1 - c.y) / 2) * size.height;
    useTour.getState().setAnchor({ x, y, r: Math.abs(((e.x + 1) / 2) * size.width - x) });
  });
  return (
    <>
      {h?.kind === "star" ? g.systems.map((s) => <Ring key={s.faction} at={() => v.set(s.x, 0, s.z)} size={s.radius * 2.2} />) : null}
      {target ? <Ring at={planetAt(target.key)} size={target.radius * 1.8} /> : null}
      {invite ? [...g.planets.values()].map((p) => <Ring key={p.key} at={planetAt(p.key)} size={p.radius * 1.6} faint />) : null}
    </>
  );
}

/** in a city: a ring at the followed robot's feet, and its point on screen */
export function TourHighlightCity() {
  const on = useTour((s) => s.step >= 0 && s.steps[s.step]?.highlight?.kind === "robot");
  const { camera, size } = useThree();
  const at = () => {
    const id = useStore.getState().followAgent;
    const r = id ? robotInfo.get(id) : undefined;
    return r?.visible ? v.set(r.anchor.x, 0.05, r.anchor.z) : null;
  };
  useFrame(() => {
    if (!on) return;
    const id = useStore.getState().followAgent;
    const r = id ? robotInfo.get(id) : undefined;
    if (!r?.visible) return;
    const s = r.anchor.clone().project(camera);
    useTour.getState().setAnchor({ x: ((s.x + 1) / 2) * size.width, y: ((1 - s.y) / 2) * size.height });
  });
  return on ? <Ring at={at} size={1.3} /> : null;
}
