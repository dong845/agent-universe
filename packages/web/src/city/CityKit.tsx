// The city drawn with the Blender kit (D19): hex ground tiles by cell kind, the buildings by what
// they stand for, and small props — lamps along the streets, crates on the plaza, crystals in the wild.
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FACTION_COLOR, type Block, type Planet } from "../galaxy/galaxyData.ts";
import { hash, type TownLayout } from "../v3/townLayout.ts";
import { KitInstances, useKit, type Placement } from "./kit.tsx";

const UP = new THREE.Vector3(0, 1, 0);
/** a hex cell's corner radius: neighbouring cells are 2 apart (townLayout.cellPos) */
export const CELL_R = 2 / Math.sqrt(3);
const TILE: Record<string, string> = { lot: "tile_lot", plaza: "tile_plaza", street: "tile_street", grass: "tile_wild" };

const place = (x: number, z: number, yaw: number, s: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(s, s, s));

/** the kit piece that draws a block */
export function pieceOf(b: Block): string {
  const i = b.spot.info;
  if (i.kind === "house") return b.spot.size >= 1.45 ? "house_l" : b.spot.size >= 1.2 ? "house_m" : "house_s";
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
    const crystal = new THREE.Color(p.look.atmo);
    for (const c of layout.cells) {
      const x = 2 * (c.q + c.r / 2), z = Math.sqrt(3) * c.r;
      const h = hash(`${p.key}|${c.q},${c.r}`, 11);
      out.push({ piece: TILE[c.kind], matrix: place(x, z, Math.floor(h * 6) * (Math.PI / 3), CELL_R * 0.985), tint: c.kind === "grass" ? ground.clone().multiplyScalar(0.85 + h * 0.3) : fac });
      // a lamp on every other street cell, at a corner
      if (c.kind === "street" && h < 0.5) {
        const a = Math.floor(h * 12) * (Math.PI / 3) + Math.PI / 6;
        out.push({ piece: "lamp", matrix: place(x + Math.cos(a) * 0.72, z + Math.sin(a) * 0.72, -a, 1.4) });
      }
      if (c.kind === "plaza" && h > 0.86) out.push({ piece: "crates", matrix: place(x + (h - 0.93) * 4, z, h * 6, 1.3), tint: fac });
      if (c.kind === "grass" && h > 0.8) out.push({ piece: "crystal", matrix: place(x + (h - 0.9) * 5, z - (h - 0.9) * 3, h * 9, 1.2 + h), tint: crystal });
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
