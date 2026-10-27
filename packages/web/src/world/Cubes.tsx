// Token cubes in flight, one instanced mesh for all of them (plan: instancing keeps draw calls low).
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Object3D, type InstancedMesh } from "three";
import { MAX_CUBES } from "../orchestrator/timeline.ts";
import { localNow, useRuntime } from "./districtContext.tsx";
import { CUBE_COLOR } from "./palette.ts";

const CAPACITY = 900;
/** cubes of one flight leave one after another, this far apart in flight progress */
const STAGGER = 0.07;

export function Cubes() {
  const rt = useRuntime();
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const colors = useMemo(() => Object.fromEntries(Object.entries(CUBE_COLOR).map(([k, v]) => [k, new Color(v)])), []);

  useLayoutEffect(() => {
    // allocate the per-instance colour buffer once
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < CAPACITY; i++) m.setColorAt(i, colors.input);
  }, [colors]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const timeline = rt.timeline;
    if (!timeline) return;
    const t = localNow(rt);
    let n = 0;
    for (const f of timeline.flights) {
      const span = f.end - f.start;
      const lead = Math.min(f.count, MAX_CUBES) - 1;
      // a flight is on screen from its start until its last cube lands
      if (t < f.start || t > f.end + lead * STAGGER * span) continue;
      for (let k = 0; k < f.count && n < CAPACITY; k++) {
        const p = (t - f.start) / span - k * STAGGER;
        if (p < 0 || p > 1) continue;
        const x = f.from.x + (f.to.x - f.from.x) * p + (k % 3 - 1) * 0.12;
        const z = f.from.z + (f.to.z - f.from.z) * p + (Math.floor(k / 3) % 2) * 0.12;
        const y = 0.9 + Math.sin(p * Math.PI) * 1.4;
        dummy.position.set(x, y, z);
        dummy.rotation.set(p * 4, p * 3, 0);
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        m.setColorAt(n, colors[f.kind]);
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CAPACITY]} frustumCulled={false}>
      <boxGeometry args={[0.16, 0.16, 0.16]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}
