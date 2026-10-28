// Camera: opens on the whole world; a focus (double-click a town, or the HUD buttons) flies there,
// and a selection (click a house, site or figure) pushes in further; a selected agent is followed.
// It also decides which towns get full detail: live towns always, plus the nearest when zoomed in.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, type OrthographicCamera } from "three";
import { sampleActor } from "../orchestrator/timeline.ts";
import { SITE_ZOOM, TASK_ZOOM, type Selection } from "../selection.ts";
import { runtimeOf, useStore } from "../store.ts";

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
  /** the agent the camera keeps following until the user drags */
  const follow = useRef<Extract<Selection, { kind: "agent" }> | null>(null);
  // test hook: whether a flight is still under way
  (window as unknown as { __agentTownFlying?: () => boolean }).__agentTownFlying = () => goal.current !== null && follow.current === null;

  useEffect(() => {
    const aim = (focus: string | null, sel: Selection | null) => {
      const { world } = useStore.getState();
      const d = (k: string | null) => (k ? world.districts.find((x) => x.key === k) : undefined);
      follow.current = sel?.kind === "agent" ? sel : null;
      if (sel?.kind === "task") {
        // the house, or the town when the task has no house drawn (older than the tier keeps, or live)
        const town = d(sel.district);
        const at = town?.houses.find((h) => h.taskId === sel.taskId)?.at ?? town?.origin;
        if (at) return void (goal.current = { target: new Vector3(at.x, 0, at.z), zoom: TASK_ZOOM });
      }
      if (sel?.kind === "site" || sel?.kind === "agent") {
        const town = d(sel.district);
        if (town) return void (goal.current = { target: new Vector3(town.origin.x, 0, town.origin.z + 2), zoom: SITE_ZOOM });
      }
      const town = d(focus);
      goal.current = town
        ? { target: new Vector3(town.origin.x, 0, town.origin.z + 2), zoom: DISTRICT_ZOOM }
        : { target: new Vector3(0, 0, 8), zoom: worldZoom(size.width, size.height) };
    };
    aim(useStore.getState().focus, useStore.getState().selected);
    return useStore.subscribe((s, p) => {
      if (s.focus !== p.focus || s.selected !== p.selected) aim(s.focus, s.selected);
    });
  }, [size.width, size.height]);

  // a user drag or wheel takes over from an unfinished flight, and stops following
  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      goal.current = null;
      follow.current = null;
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    const f = follow.current;
    if (f) {
      // keep the followed agent at the centre: the goal moves with it every frame
      const rt = runtimeOf(f.district);
      const actor = rt?.timeline?.actors.find((a) => a.id === f.agentId);
      if (rt && actor) {
        const s = sampleActor(actor, useStore.getState().t - rt.offset);
        const target = new Vector3(rt.district.origin.x + s.pos.x, 0, rt.district.origin.z + s.pos.z);
        goal.current = { target, zoom: goal.current?.zoom ?? SITE_ZOOM };
      }
    }
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 4.5);
    const delta = g.target.clone().sub(controls.target).multiplyScalar(k);
    controls.target.add(delta);
    camera.position.add(delta);
    camera.zoom += (g.zoom - camera.zoom) * k;
    camera.updateProjectionMatrix();
    controls.update();
    if (!follow.current && delta.length() < 0.01 && Math.abs(g.zoom - camera.zoom) < 0.02) goal.current = null;
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
