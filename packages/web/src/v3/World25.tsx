// The 2.5D world (spec v3 8): islands of hex columns on a calm sea, and every building a Codex-drawn
// sprite. The camera never turns, so every sprite faces it with one shared rotation and the sprites of
// one picture are drawn together (one instanced mesh per picture).
import { MapControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { opaqueAt, pixelsOf } from "./pick.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Color, CylinderGeometry, InstancedMesh, Mesh, Raycaster, RingGeometry, Vector2, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Texture, TextureLoader, Vector3, type OrthographicCamera } from "three";
import { useStore } from "../store.ts";
import { cellPos, hash } from "./townLayout.ts";
import { spritesAt, type Placed, type World25 } from "./world25Data.ts";

const EL = (30 * Math.PI) / 180;
const AZ = (45 * Math.PI) / 180;
/** from the scene toward the camera */
export const VIEW = new Vector3(Math.cos(EL) * Math.sin(AZ), Math.sin(EL), Math.cos(EL) * Math.cos(AZ));
export const RIGHT = new Vector3().crossVectors(new Vector3(0, 1, 0), VIEW).normalize();
export const UP = new Vector3().crossVectors(VIEW, RIGHT).normalize();
const FACING = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(RIGHT, UP, VIEW));
/** zoom = screen pixels per world unit (orthographic camera); a house is ~1.3 units across */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 160;
/** zoom when a request is selected: its house about 100 px across */
export const REQUEST_ZOOM = 80;

const TOP: Record<string, string> = { grass: "#9dbb6f", plaza: "#ddc8a2", street: "#cdb08a", lot: "#a9c47a" };
const HEX_R = 2 / Math.sqrt(3);

/** the camera's bounds-fitting zoom for the whole archipelago */
export function fitZoom(w: World25, width: number, height: number): number {
  let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
  for (const [k, c] of w.centers) {
    const r = w.layouts.get(k)!.radius;
    const p = new Vector3(c.x, 0, c.z);
    const pr = p.dot(RIGHT), pu = p.dot(UP);
    minR = Math.min(minR, pr - r); maxR = Math.max(maxR, pr + r);
    minU = Math.min(minU, pu - r * 0.6); maxU = Math.max(maxU, pu + r * 0.6 + 6);
  }
  if (!Number.isFinite(minR)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, 0.92 * Math.min(width / (maxR - minR), height / (maxU - minU))));
}

/** world centre of the whole archipelago */
export function worldCentre(w: World25): Vector3 {
  const cs = [...w.centers.values()];
  if (!cs.length) return new Vector3();
  return new Vector3(cs.reduce((a, c) => a + c.x, 0) / cs.length, 0, cs.reduce((a, c) => a + c.z, 0) / cs.length);
}

function Islands({ w }: { w: World25 }) {
  const cells = useMemo(() => {
    const out: { x: number; z: number; kind: string; seed: string }[] = [];
    for (const [k, l] of w.layouts) {
      const c = w.centers.get(k)!;
      for (const cell of l.cells) {
        const p = cellPos(cell.q, cell.r);
        out.push({ x: c.x + p.x, z: c.z + p.z, kind: cell.kind, seed: `${k}|${cell.q},${cell.r}` });
      }
    }
    return out;
  }, [w]);
  const cols = useRef<InstancedMesh>(null);
  const caps = useRef<InstancedMesh>(null);
  const foam = useRef<InstancedMesh>(null);
  const geo = useMemo(() => {
    const col = new CylinderGeometry(HEX_R * 0.995, HEX_R * 1.02, 1.2, 6);
    col.translate(0, -0.6, 0);
    const cap = new CylinderGeometry(HEX_R * 0.97, HEX_R * 0.995, 0.08, 6);
    cap.translate(0, -0.02, 0);
    return { col, cap, foam: new CylinderGeometry(HEX_R * 1.18, HEX_R * 1.18, 0.02, 6) };
  }, []);
  useEffect(() => {
    const m = new Matrix4();
    const col = new Color();
    cells.forEach((c, i) => {
      const h = c.kind === "grass" ? (hash(c.seed, 3) - 0.5) * 0.08 : 0;
      m.makeTranslation(c.x, h, c.z);
      cols.current!.setMatrixAt(i, m);
      caps.current!.setMatrixAt(i, m);
      col.set(TOP[c.kind] ?? TOP.grass).offsetHSL((hash(c.seed, 4) - 0.5) * 0.02, 0, (hash(c.seed, 5) - 0.5) * 0.05);
      caps.current!.setColorAt(i, col);
      col.set("#c9ae8a").offsetHSL(0, 0, (hash(c.seed, 6) - 0.5) * 0.08);
      cols.current!.setColorAt(i, col);
      m.makeTranslation(c.x, -0.84, c.z);
      foam.current!.setMatrixAt(i, m);
    });
    for (const r of [cols, caps, foam]) {
      r.current!.instanceMatrix.needsUpdate = true;
      if (r.current!.instanceColor) r.current!.instanceColor.needsUpdate = true;
      r.current!.computeBoundingSphere();
    }
  }, [cells]);
  const n = Math.max(1, cells.length);
  return (
    <>
      <instancedMesh key={`c${n}`} ref={cols} args={[geo.col, new MeshStandardMaterial({ roughness: 0.95, flatShading: true }), n]} receiveShadow />
      <instancedMesh key={`p${n}`} ref={caps} args={[geo.cap, new MeshStandardMaterial({ roughness: 0.9, flatShading: true }), n]} receiveShadow />
      <instancedMesh key={`f${n}`} ref={foam} args={[geo.foam, new MeshBasicMaterial({ color: "#e9f6f1", transparent: true, opacity: 0.55 }), n]} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.85}>
        <planeGeometry args={[6000, 6000]} />
        <meshStandardMaterial color="#7ec4c4" roughness={0.6} />
      </mesh>
    </>
  );
}

/** one picture's quads: footprint at the spot, raised toward the camera so the ground never cuts it */
export function quadOf(p: Placed, art: { anchor: [number, number]; footprint: number; aspect: number }) {
  const w = (p.spot.size * Math.SQRT2) / art.footprint;
  const h = w / art.aspect;
  const c = new Vector3(p.x, 0, p.z)
    .addScaledVector(RIGHT, (0.5 - art.anchor[0]) * w)
    .addScaledVector(UP, (art.anchor[1] - 0.5) * h)
    .addScaledVector(VIEW, (p.spot.size / Math.SQRT2) * Math.cos(EL) + 0.05);
  return { c, w, h };
}

const loader = new TextureLoader();
const textures = new Map<string, Promise<Texture>>();
function texture(url: string): Promise<Texture> {
  let t = textures.get(url);
  if (!t) {
    t = loader.loadAsync(url).then((tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    });
    textures.set(url, t);
  }
  return t;
}

function SpriteGroup({ id, url, list, art, ghost }: { id: string; url: string; list: Placed[]; art: { anchor: [number, number]; footprint: number; aspect: number }; ghost?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const [tex, setTex] = useState<Texture | null>(null);
  useEffect(() => {
    let live = true;
    texture(url).then((t) => live && setTex(t), (e) => console.error(`sprite ${id}: ${e}`));
    return () => {
      live = false;
    };
  }, [url, id]);
  // a house still being built is drawn faded
  const material = useMemo(() => (tex ? (ghost ? new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, alphaTest: 0.05, toneMapped: false, depthWrite: false }) : new MeshBasicMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, toneMapped: false })) : null), [tex, ghost]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    list.forEach((p, i) => {
      const q = quadOf(p, art);
      m.compose(q.c, FACING, new Vector3(q.w, q.h, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData = { spriteId: id, list, art, tex };
  }, [list, art, id, tex, material]);
  if (!material) return null;
  return <instancedMesh key={`${id}:${list.length}`} ref={ref} args={[PLANE, material, Math.max(1, list.length)]} name="sprite" frustumCulled={false} />;
}
const PLANE = new PlaneGeometry(1, 1);

/** soft round shadows under every standing building */
function Shadows({ placed }: { placed: Placed[] }) {
  const ref = useRef<InstancedMesh>(null);
  const tex = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, "rgba(40,30,15,0.38)");
    gr.addColorStop(1, "rgba(40,30,15,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = new Texture(cv);
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => {
    const m = new Matrix4();
    const rot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    placed.forEach((p, i) => {
      const s = p.spot.size * 1.25;
      m.compose(new Vector3(p.x + p.spot.size * 0.12, 0.03, p.z + p.spot.size * 0.06), rot, new Vector3(s, s, 1));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.count = placed.length;
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [placed]);
  return <instancedMesh key={placed.length} ref={ref} args={[PLANE, new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), Math.max(1, placed.length)]} frustumCulled={false} />;
}

/** the camera: fixed direction, pan and zoom; flies to a point when asked */
export function Camera25({ w }: { w: World25 }) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update(): void } | null;
  const fly = useRef<{ from: Vector3; to: Vector3; z0: number; z1: number; t: number } | null>(null);
  const focus = useStore((s) => s.focus);
  const selected = useStore((s) => s.selected);
  const flyTo = (to: Vector3, zoom: number) => {
    if (!controls) return;
    fly.current = { from: controls.target.clone(), to, z0: camera.zoom, z1: zoom, t: 0 };
  };
  /** where the camera should be for the current focus and selection */
  const goal = (): { at: Vector3; zoom: number } => {
    if (selected?.kind === "request") {
      const p = spotWorld(w, selected.district, selected.requestId);
      if (p) return { at: p, zoom: REQUEST_ZOOM };
    }
    const key = selected?.district ?? focus;
    if (key && w.centers.has(key)) {
      const c = w.centers.get(key)!;
      return { at: new Vector3(c.x, 0, c.z), zoom: Math.min(MAX_ZOOM, Math.max(1.2, (0.8 * size.height) / (w.layouts.get(key)!.radius * 2.2))) };
    }
    return { at: worldCentre(w), zoom: fitZoom(w, size.width, size.height) };
  };
  const placedOnce = useRef(false);
  // the first time the controls exist, jump there; afterwards every change of focus or selection flies
  useEffect(() => {
    if (!controls) return;
    const g = goal();
    if (!placedOnce.current) {
      placedOnce.current = true;
      controls.target.copy(g.at);
      camera.position.copy(g.at).addScaledVector(VIEW, 1000);
      camera.zoom = g.zoom;
      camera.updateProjectionMatrix();
      controls.update();
    } else flyTo(g.at, g.zoom);
  }, [controls, focus, selected, w]); // eslint-disable-line react-hooks/exhaustive-deps
  Object.assign(window as unknown as Record<string, unknown>, { __agentTownFlying: () => fly.current !== null, __agentTownCamera: camera, __agentTownControls: controls });
  useFrame((_, dt) => {
    const f = fly.current;
    if (!f || !controls) return;
    f.t = Math.min(1, f.t + dt / 0.7);
    const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;
    controls.target.lerpVectors(f.from, f.to, e);
    camera.position.copy(controls.target).addScaledVector(VIEW, 1000);
    camera.zoom = f.z0 + (f.z1 - f.z0) * e;
    camera.updateProjectionMatrix();
    controls.update();
    if (f.t >= 1) fly.current = null;
  });
  return <MapControls makeDefault enableRotate={false} screenSpacePanning zoomToCursor minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} enableDamping={false} />;
}

/** where a request's house or tent stands, in world space */
export function spotWorld(w: World25, town: string, requestId: string): Vector3 | null {
  const l = w.layouts.get(town);
  const c = w.centers.get(town);
  const s = l?.spots.find((x) => (x.info.kind === "house" || x.info.kind === "tent") && x.info.requestId === requestId);
  return s && c ? new Vector3(c.x + s.x, 0, c.z + s.z) : null;
}

export function World25View({ w }: { w: World25 }) {
  const t = useStore((s) => s.uiT);
  const t0 = useStore((s) => s.t0);
  // the clock moves 4×/s; buildings appear and go only when it crosses one of their times
  const marks = useMemo(() => [...new Set([...w.layouts.values()].flatMap((l) => l.spots.flatMap((s) => [s.from, s.until]).filter((x): x is number => x !== undefined)))].sort((a, b) => a - b), [w]);
  const ts = t0 + t;
  const step = useMemo(() => {
    let lo = 0, hi = marks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (marks[mid] <= ts) lo = mid + 1; else hi = mid; }
    return lo;
  }, [marks, ts]);
  const groups = useMemo(() => spritesAt(w, step === marks.length ? Infinity : marks[step] - 1), [w, step, marks]);
  const arts = useMemo(() => new Map([...w.resolved.values()].map((a) => [a.id, a])), [w]);
  const buildings = useMemo(() => [...groups.values()].flat().filter((p) => p.spot.info.kind !== "prop"), [groups]);
  return (
    <>
      <hemisphereLight args={["#fff8ee", "#9fb3a8", 1.5]} />
      <directionalLight color="#fff0d8" intensity={2.2} position={[-20, 30, 6]} />
      <Islands w={w} />
      <Shadows placed={buildings} />
      {[...groups].map(([g, list]) => {
        const ghost = g.endsWith("|live");
        const a = arts.get(ghost ? g.slice(0, -5) : g)!;
        return <SpriteGroup key={g} id={g} url={a.url} list={list} art={a} ghost={ghost} />;
      })}
      <LiveRings placed={[...groups].filter(([g]) => g.endsWith("|live")).flatMap(([, l]) => l)} />
      <Picker />
    </>
  );
}

/** a soft pulsing ring under every house still being built */
function LiveRings({ placed }: { placed: Placed[] }) {
  const ref = useRef<InstancedMesh>(null);
  const mat = useMemo(() => new MeshBasicMaterial({ color: "#f59e0b", transparent: true, opacity: 0.7, depthWrite: false }), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const k = 1 + 0.18 * Math.sin(clock.elapsedTime * 3);
    const m = new Matrix4();
    const rot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    placed.forEach((p, i) => {
      m.compose(new Vector3(p.x, 0.05, p.z), rot, new Vector3(p.spot.size * k, p.spot.size * k, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = placed.length;
    mesh.instanceMatrix.needsUpdate = true;
    mat.opacity = 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3));
  });
  return <instancedMesh key={placed.length} ref={ref} args={[RING, mat, Math.max(1, placed.length)]} frustumCulled={false} />;
}
const RING = new RingGeometry(0.62, 0.78, 40);

/** pointer → the sprite under it (opaque pixels only): hover card, and click to select */
function Picker() {
  const { gl, camera, scene, size } = useThree();
  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    const hit = (e: PointerEvent): { town: string; placed: Placed } | null => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const sprites = scene.children.filter((o): o is Mesh => o.name === "sprite") as unknown as InstancedMesh[];
      for (const h of ray.intersectObjects(sprites, false)) {
        const d = (h.object as InstancedMesh).userData as { list?: Placed[]; tex?: Texture };
        const p = h.instanceId !== undefined ? d.list?.[h.instanceId] : undefined;
        if (!p || !d.tex?.image || !h.uv) continue;
        const px = pixelsOf(d.tex.image as HTMLImageElement);
        if (opaqueAt(px.data, px.w, px.h, h.uv)) return { town: p.town, placed: p };
      }
      return null;
    };
    let down: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      const h = hit(e);
      const s = useStore.getState();
      s.setPointer(e.clientX, e.clientY);
      const cur = s.hovered?.kind === "spot" ? s.hovered.spot : null;
      if ((h?.placed.spot ?? null) !== cur) s.setHovered(h ? { kind: "spot", district: h.town, spot: h.placed.spot } : null);
      gl.domElement.style.cursor = h && h.placed.spot.info.kind !== "prop" ? "pointer" : "";
    };
    const pdown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const up = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // a drag pans, it does not select
      const h = hit(e);
      if (!h || h.placed.spot.info.kind === "prop") return;
      const info = h.placed.spot.info;
      useStore.getState().select(info.kind === "house" || info.kind === "tent" ? { kind: "request", district: h.town, requestId: info.requestId } : { kind: "town", district: h.town });
    };
    const el = gl.domElement;
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", pdown);
    el.addEventListener("pointerup", up);
    (window as unknown as { __agentTownPick?: unknown }).__agentTownPick = (x: number, y: number) => hit({ clientX: x, clientY: y } as PointerEvent);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", pdown);
      el.removeEventListener("pointerup", up);
    };
  }, [gl, camera, scene, size]);
  return null;
}
