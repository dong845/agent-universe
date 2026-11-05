// A milestone's burst of light (spec 2026-11-05 C4): rings that grow and fade at the star or the planet.
import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { create } from "zustand";
import type { Milestone } from "../ui/milestones.ts";
import { spinOf } from "./Galaxy.tsx";
import type { Galaxy } from "./galaxyData.ts";

export const useCelebrations = create<{ list: { m: Milestone; t0: number }[]; add(m: Milestone): void; drop(id: string): void }>((set, get) => ({
  list: [],
  add: (m) => set({ list: [...get().list, { m, t0: performance.now() }] }),
  drop: (id) => set({ list: get().list.filter((x) => x.m.id !== id) }),
}));

const RING = new THREE.RingGeometry(0.9, 1, 64);
const LIFE = 2600;

/** one set of rings at one place: a fixed point, or a planet that moves on its orbit */
function BurstAt({ id, t0, size, at, planet }: { id: string; t0: number; size: number; at: [number, number, number]; planet?: string }) {
  const ref = useRef<THREE.Group>(null);
  const mats = useMemo(() => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd58a").multiplyScalar(2.5), transparent: true, toneMapped: false, depthTest: false, side: THREE.DoubleSide })), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const k = (performance.now() - t0) / LIFE;
    if (k >= 1) return useCelebrations.getState().drop(id);
    const g0 = ref.current;
    if (!g0) return;
    if (planet) {
      const o = spinOf.get(planet);
      if (o) g0.position.copy(o.getWorldPosition(v));
    }
    g0.children.forEach((c, i) => {
      const kk = Math.max(0, k - i * 0.15);
      c.scale.setScalar(size * (0.6 + kk * 2.2));
      mats[i].opacity = Math.max(0, 1 - kk * 1.15);
    });
  });
  return (
    <group ref={ref} position={at}>
      {mats.map((mat, i) => <Billboard key={i}><mesh geometry={RING} material={mat} renderOrder={30} raycast={() => null} /></Billboard>)}
    </group>
  );
}

/** at the planet (a project's first piece), the faction's star (its shell), or both stars (a count) */
function Burst({ m, t0, g }: { m: Milestone; t0: number; g: Galaxy }) {
  const planet = m.kind === "first" ? g.planets.get(m.where) : undefined;
  const stars = planet ? [] : m.kind === "shell" ? g.systems.filter((s) => s.faction === m.where) : m.kind === "products" ? g.systems : [];
  // nowhere to show it (a project too small to be drawn as a planet): the toast was enough
  useEffect(() => {
    if (!planet && !stars.length) useCelebrations.getState().drop(m.id);
  }, [planet, stars.length, m.id]);
  if (planet) return <BurstAt id={m.id} t0={t0} size={planet.radius * 2} at={[0, 0, 0]} planet={planet.key} />;
  if (!stars.length) return null;
  return <>{stars.map((s) => <BurstAt key={s.faction} id={m.id} t0={t0} size={s.radius * 2} at={[s.x, 0, s.z]} />)}</>;
}

export function Celebrations({ g }: { g: Galaxy }) {
  const list = useCelebrations((s) => s.list);
  return <>{list.map(({ m, t0 }) => <Burst key={m.id} m={m} t0={t0} g={g} />)}</>;
}
