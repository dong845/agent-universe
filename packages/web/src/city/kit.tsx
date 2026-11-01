// The Blender city kit (D19, scripts/models/city.py → public/models/city.glb) and the robot model.
// Each kit piece is drawn instanced: one InstancedMesh per (piece, material part). Accent and Ground
// parts take a per-instance colour (product kind, kind of work, faction, the planet's ground).
import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useStore } from "../store.ts";
import type { Block } from "../galaxy/galaxyData.ts";

export const KIT_URL = "/models/city.glb";
export const ROBOT_URL = "/models/robot.glb";

export interface KitPart {
  geometry: THREE.BufferGeometry;
  material: string;
  /** the part's transform inside its piece */
  local: THREE.Matrix4;
}
export type Kit = Map<string, KitPart[]>;

/** the kit's pieces, each relative to its own root (the file lays them out on a grid) */
export function useKit(): Kit {
  const gltf = useGLTF(KIT_URL);
  return useMemo(() => {
    const kit: Kit = new Map();
    gltf.scene.updateMatrixWorld(true);
    for (const root of gltf.scene.children) {
      if (!root.name.startsWith("P_")) continue;
      const inv = root.matrixWorld.clone().invert();
      const parts: KitPart[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        parts.push({ geometry: m.geometry, material: (m.material as THREE.Material).name, local: inv.clone().multiply(m.matrixWorld) });
      });
      kit.set(root.name.slice(2), parts);
    }
    if (!kit.size) throw new Error(`${KIT_URL} has no pieces`);
    return kit;
  }, [gltf]);
}

/** one shared material per kit material name; Accent and Light glow (and bloom) */
const MATS = new Map<string, THREE.Material>();
export function kitMaterial(name: string): THREE.Material {
  let m = MATS.get(name);
  if (m) return m;
  const std = (color: string, metalness: number, roughness: number) => new THREE.MeshStandardMaterial({ color, metalness, roughness, envMapIntensity: 0.9 });
  switch (name) {
    case "Hull": m = std("#b8c1ce", 0.3, 0.38); break;
    case "Panel": m = std("#6b7585", 0.5, 0.4); break;
    case "Dark": m = std("#1a1e27", 0.55, 0.42); break;
    case "Metal": m = std("#a7adb8", 0.9, 0.25); break;
    case "Glass": m = std("#0a1018", 0.4, 0.06); break;
    case "Ground": m = std("#ffffff", 0.0, 0.92); break;
    case "Accent": m = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.3, 2.3), toneMapped: false }); break;
    case "Light": m = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd9a0").multiplyScalar(2.2), toneMapped: false }); break;
    default: m = std("#888888", 0.3, 0.5);
  }
  MATS.set(name, m);
  return m;
}
const TINTED = new Set(["Accent", "Ground"]);

export interface Placement {
  piece: string;
  matrix: THREE.Matrix4;
  /** colour for the piece's Accent / Ground parts */
  tint?: THREE.Color;
  /** the block this piece draws, for hover and click */
  block?: Block;
}

/** every placement of every piece, one InstancedMesh per piece part */
export function KitInstances({ kit, placements, town }: { kit: Kit; placements: Placement[]; town: string }) {
  const byPiece = useMemo(() => {
    const out = new Map<string, Placement[]>();
    for (const p of placements) {
      if (!kit.has(p.piece)) throw new Error(`the city kit has no piece "${p.piece}"`);
      out.set(p.piece, [...(out.get(p.piece) ?? []), p]);
    }
    return out;
  }, [kit, placements]);
  return (
    <>
      {[...byPiece.entries()].flatMap(([piece, list]) =>
        kit.get(piece)!.map((part, i) => <PartInstances key={`${piece}|${i}|${list.length}`} part={part} list={list} town={town} />),
      )}
    </>
  );
}

function PartInstances({ part, list, town }: { part: KitPart; list: Placement[]; town: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tinted = TINTED.has(part.material);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mx = new THREE.Matrix4();
    list.forEach((p, i) => {
      m.setMatrixAt(i, mx.multiplyMatrices(p.matrix, part.local));
      if (tinted) m.setColorAt(i, p.tint ?? new THREE.Color(1, 1, 1));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list, part, tinted]);
  const pickable = list.some((p) => p.block) && part.material !== "Accent" && part.material !== "Light";
  const blockAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? list[e.instanceId]?.block : undefined);
  return (
    <instancedMesh
      ref={ref}
      args={[part.geometry, kitMaterial(part.material), list.length]}
      castShadow={part.material !== "Ground"}
      receiveShadow
      raycast={pickable ? undefined : () => null}
      onPointerMove={pickable ? (e) => {
        const b = blockAt(e);
        if (!b) return;
        e.stopPropagation();
        const st = useStore.getState();
        if (st.hovered?.kind !== "spot" || st.hovered.spot !== b.spot) st.setHovered({ kind: "spot", district: town, spot: b.spot });
        document.body.style.cursor = "pointer";
      } : undefined}
      onPointerLeave={pickable ? () => { useStore.getState().setHovered(null); document.body.style.cursor = ""; } : undefined}
      onClick={pickable ? (e) => {
        const b = blockAt(e);
        if (!b || e.delta > 5) return;
        e.stopPropagation();
        const i = b.spot.info;
        useStore.getState().select(i.kind === "house" || i.kind === "tent" ? { kind: "request", district: town, requestId: i.requestId } : { kind: "town", district: town });
      } : undefined}
    />
  );
}

useGLTF.preload(KIT_URL);
useGLTF.preload(ROBOT_URL);
