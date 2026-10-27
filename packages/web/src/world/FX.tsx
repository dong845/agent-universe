// Feedback effects ("game feel"): short bursts that answer an event — dust and a "+1" when a floor
// goes up, a poof when a subagent appears or leaves, confetti when the task is done, cartoon smoke
// when a tool fails. All derived from the timeline, so scrubbing shows exactly the same bursts.
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Object3D, type InstancedMesh } from "three";
import { BUILDING_POS } from "../orchestrator/layout.ts";
import { sampleActor, type Timeline } from "../orchestrator/timeline.ts";
import { localNow, useRuntime, useTimeline } from "./districtContext.tsx";
import { siteTop } from "./Site.tsx";

export type BurstKind = "dust" | "poof" | "confetti" | "puff";

export interface Burst {
  t: number;
  kind: BurstKind;
  x: number;
  y: number;
  z: number;
  /** text to float up with it, e.g. "+1 层" */
  text?: string;
}

const DURATION: Record<BurstKind, number> = { dust: 900, poof: 700, confetti: 2200, puff: 1100 };
const COUNT: Record<BurstKind, number> = { dust: 10, poof: 12, confetti: 40, puff: 8 };
const CONFETTI = ["#f97316", "#facc15", "#22c55e", "#3b82f6", "#ec4899", "#14b8a6"].map((c) => new Color(c));
const DUST = new Color("#f3e3c4");
const POOF = new Color("#ffffff");
const PUFF = new Color("#6b7280");

export function burstsOf(tl: Timeline): Burst[] {
  const out: Burst[] = [];
  const mainFloors = [...tl.floors].sort((a, b) => a.t - b.t);
  mainFloors.forEach((f, i) => out.push({ t: f.t, kind: "dust", x: 0, y: siteTop(i + 1), z: 0, text: f.kind === "main" ? "+1 层" : "+1 层 · 子代理" }));
  for (const a of tl.actors) {
    if (a.kind !== "subagent") continue;
    out.push({ t: a.appear, kind: "poof", x: a.home.x, y: 0.6, z: a.home.z });
    if (a.vanish !== null) {
      const p = sampleActor(a, a.vanish - 1).pos;
      out.push({ t: a.vanish, kind: "poof", x: p.x, y: 0.6, z: p.z });
    }
  }
  if (tl.roofAt !== null) out.push({ t: tl.roofAt, kind: "confetti", x: 0, y: siteTop(tl.floors.length) + 1.2, z: 0, text: "完工！" });
  for (const s of tl.buildingSmoke) {
    const p = BUILDING_POS[s.building];
    out.push({ t: s.start, kind: "puff", x: p.x, y: 2.2, z: p.z });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** pseudo-random but fixed per particle, so a scrubbed frame always looks the same */
function hash(i: number, k: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function Bursts() {
  const rt = useRuntime();
  const tl = useTimeline();
  const bursts = useMemo(() => burstsOf(tl), [tl]);
  const balls = useRef<InstancedMesh>(null);
  const bits = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    for (const m of [balls.current, bits.current]) if (m) for (let i = 0; i < 400; i++) m.setColorAt(i, POOF);
  }, []);

  useFrame(() => {
    const t = localNow(rt);
    let nb = 0;
    let nc = 0;
    for (const b of bursts) {
      const p = (t - b.t) / DURATION[b.kind];
      if (p < 0 || p > 1) continue;
      for (let i = 0; i < COUNT[b.kind]; i++) {
        const a = hash(i, 1) * Math.PI * 2;
        const r = hash(i, 2);
        if (b.kind === "confetti") {
          const m = bits.current;
          if (!m || nc >= 400) continue;
          const spread = 0.6 + r * 2.2;
          dummy.position.set(b.x + Math.cos(a) * spread * p, b.y + 3 * p - 4.5 * p * p + hash(i, 3), b.z + Math.sin(a) * spread * p);
          dummy.rotation.set(p * 9 * hash(i, 4), p * 7, p * 5 * hash(i, 5));
          dummy.scale.set(0.16, 0.08, 0.02);
          dummy.updateMatrix();
          m.setMatrixAt(nc, dummy.matrix);
          m.setColorAt(nc, CONFETTI[i % CONFETTI.length]);
          nc++;
          continue;
        }
        const m = balls.current;
        if (!m || nb >= 400) continue;
        const reach = b.kind === "dust" ? 1.9 : b.kind === "poof" ? 0.8 : 0.6;
        const rise = b.kind === "puff" ? 1.6 * p + r * 0.4 : b.kind === "poof" ? 0.5 * p : 0.25 * p;
        const ease = 1 - (1 - p) * (1 - p);
        dummy.position.set(b.x + Math.cos(a) * reach * ease * (0.6 + r * 0.4), b.y + rise, b.z + Math.sin(a) * reach * ease * (0.6 + r * 0.4));
        dummy.rotation.set(0, 0, 0);
        const size = (b.kind === "puff" ? 0.45 : b.kind === "poof" ? 0.28 : 0.2) * (1 - p * 0.7) * (0.7 + r * 0.6);
        dummy.scale.setScalar(size);
        dummy.updateMatrix();
        m.setMatrixAt(nb, dummy.matrix);
        m.setColorAt(nb, b.kind === "dust" ? DUST : b.kind === "puff" ? PUFF : POOF);
        nb++;
      }
    }
    for (const [m, n] of [[balls.current, nb], [bits.current, nc]] as const) {
      if (!m) continue;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={balls} args={[undefined, undefined, 400]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={1} transparent opacity={0.92} />
      </instancedMesh>
      <instancedMesh ref={bits} args={[undefined, undefined, 400]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
    </group>
  );
}
