// Camera: opens on the whole world; a focus (double-click a town, or the HUD buttons) flies there.
// It also decides which towns get full detail: live towns always, plus the nearest when zoomed in.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, type OrthographicCamera } from "three";
import { useStore } from "../store.ts";

/** zoom at which building labels, figures and full-detail towns appear */
export const DETAIL_ZOOM = 11;
export const DISTRICT_ZOOM = 26;
const MAX_FULL = 4;

type Controls = { target: Vector3; update(): void; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void };

export function worldZoom(width: number, height: number): number {
  const b = useStore.getState().world.bounds;
  // the isometric footprint of the bounds, with a margin
  const w = ((b.maxX - b.minX) + (b.maxZ - b.minZ)) * Math.SQRT1_2;
  const h = w * 0.62;
  return Math.min(width / (w * 1.05), height / (h * 1.05));
}

export function CameraRig() {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const size = useThree((s) => s.size);
  const goal = useRef<{ target: Vector3; zoom: number } | null>(null);

  useEffect(() => {
    const aim = (focus: string | null) => {
      const d = focus ? useStore.getState().world.districts.find((x) => x.key === focus) : undefined;
      goal.current = d
        ? { target: new Vector3(d.origin.x, 0, d.origin.z + 2), zoom: DISTRICT_ZOOM }
        : { target: new Vector3(0, 0, 8), zoom: worldZoom(size.width, size.height) };
    };
    aim(useStore.getState().focus);
    return useStore.subscribe((s, p) => {
      if (s.focus !== p.focus) aim(s.focus);
    });
  }, [size.width, size.height]);

  // a user drag or wheel takes over from an unfinished flight
  useEffect(() => {
    if (!controls) return;
    const stop = () => (goal.current = null);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 4.5);
    const delta = g.target.clone().sub(controls.target).multiplyScalar(k);
    controls.target.add(delta);
    camera.position.add(delta);
    camera.zoom += (g.zoom - camera.zoom) * k;
    camera.updateProjectionMatrix();
    controls.update();
    if (delta.length() < 0.01 && Math.abs(g.zoom - camera.zoom) < 0.02) goal.current = null;
  });
  return null;
}

/** keeps store.detail = the towns drawn in full */
export function DetailTracker() {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const size = useThree((s) => s.size);
  const last = useRef(0);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.3) return;
    last.current = clock.elapsedTime;
    const { runtimes, focus, detail, setDetail, setNear } = useStore.getState();
    setNear(camera.zoom >= DETAIL_ZOOM);
    const keys = new Set(runtimes.filter((r) => r.timeline).map((r) => r.district.key));
    if (focus) keys.add(focus);
    if (camera.zoom >= DETAIL_ZOOM && controls) {
      const reach = Math.hypot(size.width, size.height) / 2 / camera.zoom;
      const near = runtimes
        .map((r) => ({ k: r.district.key, d: Math.hypot(r.district.origin.x - controls.target.x, r.district.origin.z - controls.target.z) - r.district.radius }))
        .filter((x) => x.d < reach)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_FULL);
      for (const n of near) keys.add(n.k);
    }
    const same = keys.size === detail.size && [...keys].every((k) => detail.has(k));
    if (!same) setDetail(keys);
  });
  return null;
}
