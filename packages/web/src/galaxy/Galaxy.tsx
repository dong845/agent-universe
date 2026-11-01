// The star-system view (spike): stars with Dyson shells, planets with cities, conveyor belts and
// trade ships. Everything is drawn from geometry and shaders; nothing needs generated art.
import { Billboard, OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { kitMaterial, useKit } from "../city/kit.tsx";
import { pieceOf, StudioEnvironment } from "../city/CityKit.tsx";
import * as THREE from "three";
import { absTime, useStore } from "../store.ts";
import { FACTION_COLOR as FACTION_HEX, panelsAt, planetPos, CAP, type Block, type Galaxy, type Planet, type StarSystem } from "./galaxyData.ts";
import { useGLTF } from "@react-three/drei";
import { EMBLEM_NODE, EMBLEMS_URL } from "./emblem.ts";
import { useEnter } from "../city/cityReplay.ts";
import { ATMO, BELT, PLANET, RING, SHELL, SKY, STAR, STARS } from "./shaders.ts";

/** the orbit clock, seconds; planets and ships move on it whatever the playback does */
export const orbit = { sec: 0, /** a `?paused=1` link (screenshots, tests) holds the sky still until play */ frozen: new URLSearchParams(location.search).get("paused") === "1" };
/** each planet's spinning group, for labels and the camera */
export const spinOf = new Map<string, THREE.Object3D>();
const noRay = () => null;
const KIND_ID = { rock: 0, ice: 1, gas: 2, lava: 3, ocean: 4, moon: 5 } as const;
const col = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ---- shared geometry: every part stands on y = 0 and is one unit tall -----------------------------
const G = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0),
  hex: new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0),
  cone: new THREE.ConeGeometry(0.5, 1, 12).translate(0, 0.5, 0),
  dome: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  ball: new THREE.SphereGeometry(0.5, 16, 10).translate(0, 0.5, 0),
  torus: new THREE.TorusGeometry(1, 0.08, 8, 40).rotateX(Math.PI / 2),
};
export type GeomKey = keyof typeof G;
const SPHERE = new THREE.SphereGeometry(1, 96, 64);
const ATMO_SPHERE = new THREE.SphereGeometry(1, 64, 40);

const hullMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38 });
const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.4), toneMapped: false });
const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
export const MATS = { hull: hullMat, glow: glowMat, beam: beamMat };
/** the solid faction emblems Blender builds from the marks' SVGs, one geometry per faction */
function useEmblemGeometry(faction: StarSystem["faction"]): THREE.BufferGeometry {
  const gltf = useGLTF(EMBLEMS_URL);
  return useMemo(() => {
    const o = gltf.scene.getObjectByName(EMBLEM_NODE[faction]) as THREE.Mesh | undefined;
    if (!o?.isMesh) throw new Error(`${EMBLEMS_URL} has no mesh "${EMBLEM_NODE[faction]}"`);
    // the node may sit off the origin in the file; its geometry is already centred
    return o.geometry;
  }, [gltf, faction]);
}
useGLTF.preload(EMBLEMS_URL);
const emblemMat = (hex: string, k: number, opacity: number) => new THREE.MeshBasicMaterial({ color: col(hex, k), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });

type EmblemProps = { faction: StarSystem["faction"]; use: "badge" | "corona"; scale: number; position?: [number, number, number]; speed?: number };
/** the faction's mark, always facing the camera, turning slowly in its own plane */
export function Emblem(props: EmblemProps) {
  return <Suspense fallback={null}><EmblemMark {...props} /></Suspense>;
}

function EmblemMark({ faction, use, scale, position = [0, 0, 0], speed = 0.05 }: EmblemProps) {
  const geometry = useEmblemGeometry(faction);
  // a badge is a solid glowing mark; a star's corona is a faint hologram that adds to the light
  const base = use === "corona" ? 0.45 : 1;
  const mat = useMemo(() => (use === "corona" ? emblemMat(FACTION_HEX[faction], 1.6, base) : new THREE.MeshBasicMaterial({ color: col(FACTION_HEX[faction], 1.9), toneMapped: false, fog: false })), [faction, use, base]);
  useEffect(() => () => mat.dispose(), [mat]);
  const ref = useRef<THREE.Mesh>(null);
  const w = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock, camera }) => {
    const m = ref.current;
    if (!m) return;
    m.rotation.z = clock.elapsedTime * speed;
    // a star's emblem is for the view from afar: it fades out as the camera comes in
    if (use === "corona") {
      const d = camera.position.distanceTo(m.getWorldPosition(w));
      const t = Math.min(1, Math.max(0, (d - scale * 2.2) / (scale * 3)));
      mat.opacity = base * t * t;
      m.visible = mat.opacity > 0.01;
    }
  });
  return (
    <Billboard position={position}>
      <mesh ref={ref} geometry={geometry} material={mat} scale={scale} raycast={noRay} />
    </Billboard>
  );
}

// ---- sky ---------------------------------------------------------------------------------------------
export function Sky() {
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: SKY.vertex, fragmentShader: SKY.fragment, side: THREE.BackSide, depthWrite: false }), []);
  return <mesh geometry={useMemo(() => new THREE.SphereGeometry(5000, 256, 128), [])} material={mat} renderOrder={-10} frustumCulled={false} raycast={noRay} />;
}

export function Starfield() {
  const { gl } = useThree();
  const [geo, mat] = useMemo(() => {
    const n = 9000;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), c = new Float32Array(n * 3), ph = new Float32Array(n);
    const tints = [new THREE.Color("#9fc4ff"), new THREE.Color("#ffffff"), new THREE.Color("#ffe2b8"), new THREE.Color("#c8b8ff")];
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 3000 + rnd() * 1200;
      // a denser band across the sky, like a galaxy's disc
      const v = rnd() < 0.45 ? (rnd() - 0.5) * 0.35 : u;
      const k = Math.sqrt(1 - v * v);
      pos.set([Math.cos(a) * k * r, v * r, Math.sin(a) * k * r], i * 3);
      const big = rnd();
      size[i] = big > 0.995 ? 4.2 : big > 0.96 ? 2.6 : 0.8 + rnd() * 1.4;
      const t = tints[Math.floor(rnd() * tints.length)];
      const b = 0.35 + rnd() * 0.9 * (size[i] / 2.6);
      c.set([t.r * b, t.g * b, t.b * b], i * 3);
      ph[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aCol", new THREE.BufferAttribute(c, 3));
    g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: STARS.vertex, fragmentShader: STARS.fragment, uniforms: { uTime: { value: 0 }, uDpr: { value: gl.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return [g, m];
  }, [gl]);
  useFrame(({ clock }) => (mat.uniforms.uTime.value = clock.elapsedTime));
  return <points geometry={geo} material={mat} frustumCulled={false} raycast={noRay} />;
}

// ---- a star and its Dyson shell ----------------------------------------------------------------------
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

function shellGeometry(): { geo: THREE.BufferGeometry; faces: number } {
  const ico = new THREE.IcosahedronGeometry(1, 7);
  const p = ico.getAttribute("position");
  const faces = p.count / 3;
  const order = Array.from({ length: faces }, (_, f) => {
    const c = new THREE.Vector3();
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(p, f * 3 + k));
    c.divideScalar(3).normalize();
    const lon = Math.atan2(c.z, c.x);
    // an equatorial band first, growing towards the poles, swept round by longitude
    return { f, key: Math.abs(c.y) + ((lon + Math.PI) / (2 * Math.PI)) * 0.04 + (Math.sin(f * 12.9898) * 0.5 + 0.5) * 0.03 };
  }).sort((a, b) => a.key - b.key);
  const pos = new Float32Array(faces * 9), nor = new Float32Array(faces * 9), idx = new Float32Array(faces * 3), bary = new Float32Array(faces * 9);
  order.forEach(({ f }, rank) => {
    const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, f * 3 + k));
    const c = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
    const n = c.clone().normalize();
    v.forEach((x, k) => {
      const s = c.clone().add(x.clone().sub(c).multiplyScalar(0.9));
      pos.set([s.x, s.y, s.z], rank * 9 + k * 3);
      nor.set([n.x, n.y, n.z], rank * 9 + k * 3);
      bary.set(k === 0 ? [1, 0, 0] : k === 1 ? [0, 1, 0] : [0, 0, 1], rank * 9 + k * 3);
      idx[rank * 3 + k] = rank;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("aIdx", new THREE.BufferAttribute(idx, 1));
  geo.setAttribute("aBary", new THREE.BufferAttribute(bary, 3));
  ico.dispose();
  return { geo, faces };
}
const SHELL_GEO = shellGeometry();
export const SHELL_FACES = SHELL_GEO.faces;

export function StarView({ s, light = true }: { s: StarSystem; light?: boolean }) {
  const star = useMemo(() => new THREE.ShaderMaterial({ vertexShader: STAR.vertex, fragmentShader: STAR.fragment, uniforms: { uTime: { value: 0 }, uColor: { value: col(s.color) }, uHot: { value: col("#fff6e8") } } }), [s.color]);
  const shell = useMemo(() => new THREE.ShaderMaterial({ vertexShader: SHELL.vertex, fragmentShader: SHELL.fragment, uniforms: { uCount: { value: 0 }, uColor: { value: col(s.color, 1.2) }, uTime: { value: 0 } }, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [s.color]);
  const spriteA = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: col(s.color, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }), [s.color]);
  const spriteB = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: col(s.color, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }), [s.color]);
  const shellRef = useRef<THREE.Mesh>(null);
  useEffect(() => () => [star, shell, spriteA, spriteB].forEach((m) => m.dispose()), [star, shell, spriteA, spriteB]);
  useFrame(({ clock }) => {
    star.uniforms.uTime.value = clock.elapsedTime;
    shell.uniforms.uTime.value = clock.elapsedTime;
    const st = useStore.getState();
    shell.uniforms.uCount.value = Math.min(SHELL_FACES, panelsAt(s, absTime(st.t)));
    if (shellRef.current) shellRef.current.rotation.y = clock.elapsedTime * 0.012;
  });
  const hover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const st = useStore.getState();
    if (st.hovered?.kind !== "faction" || st.hovered.faction !== s.faction) st.setHovered({ kind: "faction", faction: s.faction });
  };
  return (
    <group position={[s.x, 0, s.z]}>
      <mesh geometry={SPHERE} material={star} scale={s.radius} onPointerMove={hover} onPointerLeave={() => useStore.getState().setHovered(null)} />
      <sprite material={spriteA} scale={s.radius * 7} raycast={noRay} />
      <sprite material={spriteB} scale={s.radius * 22} raycast={noRay} />
      <Emblem faction={s.faction} use="corona" scale={s.shellRadius * (s.faction === "codex" ? 1.55 : 1.7)} speed={0.03} />
      <mesh ref={shellRef} geometry={SHELL_GEO.geo} material={shell} scale={s.shellRadius} raycast={noRay} rotation={[0.18, 0, 0.08]} />
      {light ? <pointLight color={col(s.color).lerp(new THREE.Color("#ffffff"), 0.6)} intensity={3.2} decay={0} distance={0} /> : null}
    </group>
  );
}

function Orbits({ s }: { s: StarSystem }) {
  const [geo, mat] = useMemo(() => {
    const pts: number[] = [];
    for (const p of s.planets) {
      const n = 160;
      for (let i = 0; i < n; i++) {
        const a = planetPos(p, s, (i / n) * p.period), b = planetPos(p, s, ((i + 1) / n) * p.period);
        pts.push(...a, ...b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return [g, new THREE.LineBasicMaterial({ color: col(s.color), transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending })];
  }, [s]);
  return <lineSegments geometry={geo} material={mat} raycast={noRay} />;
}

// ---- a planet and its city ---------------------------------------------------------------------------
export interface Part {
  geom: GeomKey;
  mat: keyof typeof MATS;
  color: THREE.Color;
  m: THREE.Matrix4;
  block?: number;
}
const UP = new THREE.Vector3(0, 1, 0);
const HULL = new THREE.Color("#9fadc0");

/** where a block stands: its foot point, the local up, its turn, and a size factor */
export type Frame = (b: Block) => { origin: THREE.Vector3; up: THREE.Vector3; q: THREE.Quaternion; k: number };
/** on a planet of radius r: blocks stand on the sphere, up = out from the centre */
export const planetFrame = (r: number): Frame => (b) => {
  const dir = new THREE.Vector3(...b.dir);
  return { origin: dir.clone().multiplyScalar(r), up: dir, q: new THREE.Quaternion().setFromUnitVectors(UP, dir).multiply(new THREE.Quaternion().setFromAxisAngle(UP, b.turn)), k: 1 };
};

export function partsOf(blocks: Block[], frame: Frame): Part[] {
  const out: Part[] = [];
  blocks.forEach((b0, bi) => {
    const { origin, up, q, k } = frame(b0);
    const b = { ...b0, foot: b0.foot * k, height: b0.height * k };
    const put = (geom: GeomKey, mat: Part["mat"], color: THREE.Color, alt: number, sx: number, sy: number, sz = sx, pick = false) => {
      const m = new THREE.Matrix4().compose(origin.clone().addScaledVector(up, alt - b.foot * 0.04), q, new THREE.Vector3(sx, sy, sz));
      out.push({ geom, mat, color, m, block: pick ? bi : undefined });
    };
    const f = b.foot, h = b.height, c = new THREE.Color(b.color);
    const hull = HULL.clone().lerp(c, 0.12);
    if (b.type === "house") {
      put("box", "hull", hull, 0, f, h, f, true);
      put("box", "glow", c, h * 0.42, f * 1.04, f * 0.07, f * 1.04);
      if (h > f) put("box", "glow", c, h * 0.74, f * 1.04, f * 0.07, f * 1.04);
      put("box", "glow", c.clone().lerp(new THREE.Color("#ffffff"), 0.4), h, f * 0.5, f * 0.06, f * 0.5);
    } else if (b.type === "tent") {
      put("dome", "hull", HULL.clone().lerp(new THREE.Color("#dff3ff"), 0.4), 0, f * 0.5, h, f * 0.5, true);
      put("torus", "glow", c, f * 0.02, f * 0.52, f * 0.5, f * 0.52);
      put("cyl", "hull", hull, h, f * 0.05, f * 0.35);
      put("ball", "glow", c, h + f * 0.33, f * 0.12, f * 0.12);
    } else if (b.type === "public") {
      put("cyl", "hull", hull, 0, f * 0.82, h, f * 0.82, true);
      put("cyl", "glow", c, h * 0.8, f * 0.88, f * 0.08, f * 0.88);
      put("cyl", "glow", c, h * 0.35, f * 0.86, f * 0.05, f * 0.86);
      put("cone", "hull", hull, h, f * 0.6, f * 0.35);
      put("ball", "glow", c, h + f * 0.3, f * 0.16, f * 0.16);
    } else if (b.type === "landmark") {
      put("hex", "hull", hull, 0, f * 1.0, f * 0.28, f * 1.0, true);
      put("hex", "glow", c, f * 0.27, f * 1.04, f * 0.04, f * 1.04);
      put("cyl", "hull", hull, f * 0.28, f * 0.24, h, f * 0.24, true);
      for (const k of [0.35, 0.6, 0.85]) put("cyl", "glow", c, f * 0.28 + h * k, f * 0.32, f * 0.04, f * 0.32);
      put("cone", "hull", hull, f * 0.28 + h, f * 0.24, f * 0.7);
      put("ball", "glow", c.clone().multiplyScalar(1.4), f * 0.28 + h + f * 0.7, f * 0.26, f * 0.26);
    } else if (b.type === "hall") {
      put("hex", "hull", hull, 0, f * 1.15, h, f * 1.15, true);
      put("hex", "glow", c, h * 0.78, f * 1.19, f * 0.06, f * 1.19);
      put("hex", "hull", hull, h, f * 0.6, f * 0.18, f * 0.6);
      put("ball", "glow", c, h + f * 0.12, f * 0.3, f * 0.3);
    } else if (b.type === "notice") {
      put("cyl", "hull", hull, 0, f * 0.1, h, f * 0.1, true);
      put("box", "hull", hull, h * 0.62, f * 0.55, f * 0.32, f * 0.06, true);
      put("box", "glow", c, h * 0.62 + f * 0.05, f * 0.48, f * 0.22, f * 0.07);
      put("ball", "glow", c, h, f * 0.14, f * 0.14);
    }
    if (b.live) put("cyl", "beam", c, h, f * 0.35, f * 9, f * 0.35);
  });
  return out;
}

function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const d = Math.min(1, Math.max(-1, a.dot(b)));
  const w = Math.acos(d);
  if (w < 1e-4) return a.clone();
  const s = Math.sin(w);
  return a.clone().multiplyScalar(Math.sin((1 - t) * w) / s).add(b.clone().multiplyScalar(Math.sin(t * w) / s));
}

function beltGeometry(p: Planet, visible: Set<number>): THREE.BufferGeometry {
  const pos: number[] = [], s: number[] = [], t: number[] = [], c: number[] = [], den: number[] = [], index: number[] = [];
  const r = p.radius * 1.006;
  const w = Math.max(0.02, p.radius * 0.011);
  p.belts.forEach((bt, i) => {
    if (!visible.has(i)) return;
    const a = new THREE.Vector3(...bt.a), b = new THREE.Vector3(...bt.b);
    const ang = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    const n = Math.max(6, Math.ceil(ang / 0.02));
    const cc = new THREE.Color(bt.color);
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const q = slerp(a, b, u);
      const q2 = slerp(a, b, Math.min(1, u + 0.01));
      const q0 = slerp(a, b, Math.max(0, u - 0.01));
      const tan = q2.clone().sub(q0).normalize();
      const side = new THREE.Vector3().crossVectors(tan, q).normalize().multiplyScalar(w);
      const m = q.clone().multiplyScalar(r);
      pos.push(m.x + side.x, m.y + side.y, m.z + side.z, m.x - side.x, m.y - side.y, m.z - side.z);
      s.push(u * ang * r, u * ang * r);
      t.push(1, -1);
      c.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
      den.push(bt.density, bt.density);
      if (k < n) {
        const v = base + k * 2;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute("aCol", new THREE.Float32BufferAttribute(c, 3));
  g.setAttribute("aDen", new THREE.Float32BufferAttribute(den, 1));
  g.setIndex(index);
  return g;
}

/** which blocks stand at `ts` (a landmark's tier, a house not yet finished) */
export const standing = (b: Block, ts: number) => (b.from === undefined || b.from <= ts) && (b.until === undefined || b.until > ts);

export function Instanced({ parts, geom, mat, onBlock, blocks, town }: { parts: Part[]; geom: GeomKey; mat: keyof typeof MATS; blocks: Block[]; town: string; onBlock: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    parts.forEach((p, i) => {
      m.setMatrixAt(i, p.m);
      m.setColorAt(i, p.color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [parts]);
  const blockAt = (e: ThreeEvent<PointerEvent>) => (e.instanceId !== undefined ? parts[e.instanceId]?.block : undefined);
  const move = (e: ThreeEvent<PointerEvent>) => {
    const bi = blockAt(e);
    if (bi === undefined) return;
    e.stopPropagation();
    const st = useStore.getState();
    const spot = blocks[bi].spot;
    if (st.hovered?.kind !== "spot" || st.hovered.spot !== spot) st.setHovered({ kind: "spot", district: town, spot });
    document.body.style.cursor = "pointer";
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5 || e.instanceId === undefined) return;
    const bi = parts[e.instanceId]?.block;
    if (bi === undefined) return;
    e.stopPropagation();
    const info = blocks[bi].spot.info;
    useStore.getState().select(info.kind === "house" || info.kind === "tent" ? { kind: "request", district: town, requestId: info.requestId } : { kind: "town", district: town });
  };
  return (
    <instancedMesh
      key={parts.length}
      ref={ref}
      args={[G[geom], MATS[mat], parts.length]}
      castShadow={mat === "hull"}
      receiveShadow={mat === "hull"}
      raycast={onBlock ? undefined : noRay}
      onPointerMove={onBlock ? move : undefined}
      onPointerLeave={onBlock ? () => { useStore.getState().setHovered(null); document.body.style.cursor = ""; } : undefined}
      onClick={onBlock ? click : undefined}
    />
  );
}

function City({ p }: { p: Planet }) {
  // the city changes only when a block starts or stops standing: rebuild on that, not every frame
  // re-render only when the set of standing blocks changes
  const sig = useStore((s) => { const ts = absTime(s.uiT); return p.blocks.map((b) => (standing(b, ts) ? 1 : 0)).join(""); });
  const { groups, belts } = useMemo(() => {
    const vis = p.blocks.filter((b, i) => sig[i] === "1");
    const parts = partsOf(vis, planetFrame(p.radius));
    const groups = new Map<string, Part[]>();
    for (const x of parts) {
      const k = `${x.geom}|${x.mat}`;
      groups.set(k, [...(groups.get(k) ?? []), x]);
    }
    // belts run only to standing blocks
    const standingDirs = new Set(vis.map((b) => b.dir.join(",")));
    const vb = new Set(p.belts.map((b, i) => (standingDirs.has(b.a.join(",")) ? i : -1)).filter((i) => i >= 0));
    return { groups, belts: beltGeometry(p, vb), vis };
  }, [p, sig]);
  const visBlocks = useMemo(() => p.blocks.filter((_, i) => sig[i] === "1"), [p, sig]);
  // the emblem floats above the task hall
  const hall = useMemo(() => {
    const b = p.blocks.find((x) => x.type === "hall");
    if (!b) return null;
    const v = new THREE.Vector3(...b.dir).multiplyScalar(p.radius + b.height + b.foot * 1.25);
    return { foot: b.foot, pos: [v.x, v.y, v.z] as [number, number, number] };
  }, [p]);
  const beltMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: BELT.vertex, fragmentShader: BELT.fragment, uniforms: { uTime: { value: 0 }, uSpeed: { value: p.live ? 1.6 : 0.45 } }, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [p.live]);
  useEffect(() => () => belts.dispose(), [belts]);
  useEffect(() => () => beltMat.dispose(), [beltMat]);
  useFrame(({ clock }) => {
    beltMat.uniforms.uTime.value = clock.elapsedTime;
    beamMat.opacity = 0.22 + 0.14 * Math.sin(clock.elapsedTime * 3);
  });
  // the planet the camera is on wears the Blender kit; the rest keep the plain shapes (too small to tell)
  const near = useStore((s) => s.focus === p.key);
  const plain = [...groups.entries()].map(([k, parts]) => {
    const [geom, mat] = k.split("|") as [GeomKey, keyof typeof MATS];
    return <Instanced key={k} parts={parts} geom={geom} mat={mat} blocks={visBlocks} town={p.key} onBlock={mat === "hull"} />;
  });
  return (
    <>
      {near ? (
        <Suspense fallback={plain}>
          <PlanetKit p={p} vis={visBlocks} />
          {[...groups.entries()].filter(([k]) => k.endsWith("|beam")).map(([k, parts]) => <Instanced key={k} parts={parts} geom={k.split("|")[0] as GeomKey} mat="beam" blocks={visBlocks} town={p.key} onBlock={false} />)}
        </Suspense>
      ) : plain}
      <mesh geometry={belts} material={beltMat} raycast={noRay} />
      {hall ? <Emblem faction={p.town.faction} use="badge" scale={hall.foot * 0.95} position={hall.pos} speed={0.4} /> : null}
    </>
  );
}

/**
 * A planet's city in the Blender kit: every standing block's piece placed on the sphere and merged
 * into one mesh per material (a city is drawn in a handful of calls). A hit finds its block from the
 * vertex it landed on.
 */
function PlanetKit({ p, vis }: { p: Planet; vis: Block[] }) {
  const kit = useKit();
  const merged = useMemo(() => {
    const byMat = new Map<string, { geos: THREE.BufferGeometry[]; starts: { at: number; block: Block }[]; count: number }>();
    const frame = planetFrame(p.radius);
    for (const b of vis) {
      const parts = kit.get(pieceOf(b));
      if (!parts) throw new Error(`the city kit has no piece "${pieceOf(b)}"`);
      const { origin, up, q } = frame(b);
      const k = b.foot * (b.type === "notice" ? 1.4 : 1);
      const m = new THREE.Matrix4().compose(origin.clone().addScaledVector(up, -b.foot * 0.04), q, new THREE.Vector3(k, k, k));
      const c = new THREE.Color(b.color);
      for (const part of parts) {
        const src = part.geometry;
        if (!src.index) throw new Error("kit geometry is expected to be indexed");
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", src.getAttribute("position").clone());
        g.setAttribute("normal", src.getAttribute("normal").clone());
        g.setIndex(src.index.clone());
        g.applyMatrix4(m.clone().multiply(part.local));
        const n = g.getAttribute("position").count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        const e = byMat.get(part.material) ?? { geos: [], starts: [], count: 0 };
        e.starts.push({ at: e.count, block: b });
        e.count += n;
        e.geos.push(g);
        byMat.set(part.material, e);
      }
    }
    return [...byMat.entries()].map(([mat, e]) => {
      const geo = mergeGeometries(e.geos, false);
      if (!geo) throw new Error(`could not merge the ${mat} parts of ${p.key}`);
      e.geos.forEach((g) => g.dispose());
      return { mat, geo, starts: e.starts };
    });
  }, [kit, vis, p]);
  useEffect(() => () => merged.forEach((x) => x.geo.dispose()), [merged]);
  const accent = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.3, 2.3), vertexColors: true, toneMapped: false }), []);
  useEffect(() => () => accent.dispose(), [accent]);
  const blockAt = (starts: { at: number; block: Block }[], v: number) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid].at <= v) lo = mid;
      else hi = mid - 1;
    }
    return starts[lo]?.block;
  };
  return (
    <>
      {merged.map(({ mat, geo, starts }) => {
        const pick = mat !== "Accent" && mat !== "Light";
        return (
          <mesh
            key={mat} geometry={geo} material={mat === "Accent" ? accent : kitMaterial(mat)}
            raycast={pick ? undefined : noRay}
            onPointerMove={pick ? (e) => {
              const b = e.face ? blockAt(starts, e.face.a) : undefined;
              if (!b) return;
              e.stopPropagation();
              const st = useStore.getState();
              if (st.hovered?.kind !== "spot" || st.hovered.spot !== b.spot) st.setHovered({ kind: "spot", district: p.key, spot: b.spot });
              document.body.style.cursor = "pointer";
            } : undefined}
            onPointerLeave={pick ? () => { useStore.getState().setHovered(null); document.body.style.cursor = ""; } : undefined}
            onClick={pick ? (e) => {
              const b = e.face ? blockAt(starts, e.face.a) : undefined;
              if (!b || e.delta > 5) return;
              e.stopPropagation();
              const i = b.spot.info;
              useStore.getState().select(i.kind === "house" || i.kind === "tent" ? { kind: "request", district: p.key, requestId: i.requestId } : { kind: "town", district: p.key });
            } : undefined}
          />
        );
      })}
    </>
  );
}

function PlanetView({ p, s }: { p: Planet; s: StarSystem }) {
  const outer = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const L = p.look;
  const surface = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: PLANET.vertex, fragmentShader: PLANET.fragment,
    uniforms: {
      uStar: { value: new THREE.Vector3(s.x, 0, s.z) }, uA: { value: col(L.a) }, uB: { value: col(L.b) }, uC: { value: col(L.c) },
      uAtmo: { value: col(L.atmo) }, uCity: { value: col(s.color, 1.6) }, uKind: { value: KIND_ID[L.kind] }, uSeed: { value: p.seed },
      uCap: { value: Math.cos(CAP + 0.12) }, uTime: { value: 0 }, uTiles: { value: 14 + p.radius * 7 },
    },
  }), [p, s, L]);
  const atmo = useMemo(() => new THREE.ShaderMaterial({ vertexShader: ATMO.vertex, fragmentShader: ATMO.fragment, uniforms: { uColor: { value: col(L.atmo, 1.1) }, uStar: { value: new THREE.Vector3(s.x, 0, s.z) }, uInner: { value: 1 / 1.16 } }, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [L, s]);
  const ring = useMemo(() => (p.ring ? new THREE.ShaderMaterial({ vertexShader: RING.vertex, fragmentShader: RING.fragment, uniforms: { uColor: { value: col(L.c).lerp(col(L.atmo), 0.4) }, uInner: { value: p.radius * 1.55 }, uOuter: { value: p.radius * 2.35 }, uSeed: { value: p.seed } }, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }) : null), [p, L]);
  const bead = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: col(L.atmo, 1.6), sizeAttenuation: false, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }), [L]);
  useEffect(() => () => bead.dispose(), [bead]);
  const ringGeo = useMemo(() => (p.ring ? new THREE.RingGeometry(p.radius * 1.55, p.radius * 2.35, 160, 1) : null), [p]);
  useEffect(() => () => { surface.dispose(); atmo.dispose(); ring?.dispose(); ringGeo?.dispose(); }, [surface, atmo, ring, ringGeo]);
  useEffect(() => {
    if (spin.current) spinOf.set(p.key, spin.current);
    return () => void spinOf.delete(p.key);
  }, [p.key]);
  useFrame(({ clock }) => {
    const [x, y, z] = planetPos(p, s, orbit.sec);
    outer.current?.position.set(x, y, z);
    if (spin.current) spin.current.rotation.y = orbit.sec * (0.02 + 0.02 * (p.seed % 1));
    surface.uniforms.uTime.value = clock.elapsedTime;
  });
  const hover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const st = useStore.getState();
    if (st.hovered?.kind !== "district" || st.hovered.district !== p.key) st.setHovered({ kind: "district", district: p.key });
    document.body.style.cursor = "pointer";
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    useStore.getState().select({ kind: "town", district: p.key });
    useEnter.getState().request(p.key);
  };
  return (
    <group ref={outer}>
      {/* the pole (the city) leans towards the default view */}
      <group rotation={[0.42, 0, 0.12]}>
        <group ref={spin}>
          <mesh geometry={SPHERE} material={surface} scale={p.radius} onPointerMove={hover} onPointerLeave={() => { useStore.getState().setHovered(null); document.body.style.cursor = ""; }} onClick={click} />
          <City p={p} />
        </group>
        <mesh geometry={ATMO_SPHERE} material={atmo} scale={p.radius * 1.16} raycast={noRay} />
        <sprite material={bead} scale={0.014 + 0.004 * p.radius} raycast={noRay} />
        {ring && ringGeo ? <mesh geometry={ringGeo} material={ring} rotation={[-Math.PI / 2 + 0.25, 0, 0]} raycast={noRay} /> : null}
      </group>
    </group>
  );
}

// ---- trade ships between planets ------------------------------------------------------------------------
const TRAIL = 14;
function Ships({ g }: { g: Galaxy }) {
  const ships = useMemo(() => g.routes.flatMap((r) => { const n = Math.min(4, 1 + Math.floor(Math.log2(r.count))); return Array.from({ length: n }, (_, k) => ({ r, k, n })); }), [g]);
  const sysOf = useMemo(() => new Map(g.systems.map((s) => [s.faction, s])), [g]);
  const shipGeo = useMemo(() => new THREE.ConeGeometry(0.09, 0.42, 6).rotateX(Math.PI / 2), []);
  const shipMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), toneMapped: false }), []);
  const [trailGeo, routeGeo] = useMemo(() => {
    const t = new THREE.BufferGeometry();
    t.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ships.length * TRAIL * 6), 3));
    t.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ships.length * TRAIL * 6), 3));
    const r = new THREE.BufferGeometry();
    r.setAttribute("position", new THREE.BufferAttribute(new Float32Array(g.routes.length * 48 * 6), 3));
    return [t, r];
  }, [ships, g]);
  const trailMat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const routeMat = useMemo(() => new THREE.LineBasicMaterial({ color: new THREE.Color("#9fd8ff"), transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    ships.forEach((sh, i) => m.setColorAt(i, new THREE.Color(sysOf.get(sh.r.faction)!.color)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [ships, sysOf]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3();
    const bez = (u: number, out: THREE.Vector3) => out.copy(A).multiplyScalar((1 - u) * (1 - u)).addScaledVector(C, 2 * u * (1 - u)).addScaledVector(B, u * u);
    const ends = new Map<number, { A: THREE.Vector3; B: THREE.Vector3; C: THREE.Vector3 }>();
    const rp = routeGeo.getAttribute("position") as THREE.BufferAttribute;
    g.routes.forEach((r, ri) => {
      const s = sysOf.get(r.faction)!;
      const pa = g.planets.get(r.a)!, pb = g.planets.get(r.b)!;
      A.set(...planetPos(pa, s, orbit.sec));
      B.set(...planetPos(pb, s, orbit.sec));
      const d = A.distanceTo(B);
      C.copy(A).add(B).multiplyScalar(0.5).add(new THREE.Vector3(0, d * 0.22 + 2, 0));
      ends.set(ri, { A: A.clone(), B: B.clone(), C: C.clone() });
      for (let k = 0; k < 48; k++) {
        bez(k / 48, P);
        bez((k + 0.55) / 48, Q);
        rp.setXYZ(ri * 96 + k * 2, P.x, P.y, P.z);
        rp.setXYZ(ri * 96 + k * 2 + 1, Q.x, Q.y, Q.z);
      }
    });
    rp.needsUpdate = true;
    const tp = trailGeo.getAttribute("position") as THREE.BufferAttribute;
    const tc = trailGeo.getAttribute("color") as THREE.BufferAttribute;
    const mat = new THREE.Matrix4();
    const routeIndex = new Map(g.routes.map((r, i) => [r, i]));
    ships.forEach((sh, i) => {
      const e = ends.get(routeIndex.get(sh.r)!)!;
      A.copy(e.A); B.copy(e.B); C.copy(e.C);
      const dur = 7 + A.distanceTo(B) / 9;
      let u = (orbit.sec / dur + sh.k / sh.n) % 1;
      const back = sh.k % 2 === 1;
      if (back) u = 1 - u;
      const ease = (x: number) => x * x * (3 - 2 * x);
      const uu = ease(u);
      bez(uu, P);
      bez(Math.min(1, Math.max(0, uu + (back ? -0.01 : 0.01))), Q);
      mat.lookAt(P, Q, UP).setPosition(P);
      // forward is +Z after the cone's turn; lookAt points -Z at the target, so flip
      mat.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      m.setMatrixAt(i, mat);
      const c = new THREE.Color(sysOf.get(sh.r.faction)!.color);
      for (let j = 0; j < TRAIL; j++) {
        const u0 = ease(Math.min(1, Math.max(0, u + (back ? 1 : -1) * j * 0.006)));
        const u1 = ease(Math.min(1, Math.max(0, u + (back ? 1 : -1) * (j + 1) * 0.006)));
        bez(u0, P);
        bez(u1, Q);
        const o = (i * TRAIL + j) * 2;
        tp.setXYZ(o, P.x, P.y, P.z);
        tp.setXYZ(o + 1, Q.x, Q.y, Q.z);
        const f0 = (1 - j / TRAIL) * 1.6, f1 = (1 - (j + 1) / TRAIL) * 1.6;
        tc.setXYZ(o, c.r * f0, c.g * f0, c.b * f0);
        tc.setXYZ(o + 1, c.r * f1, c.g * f1, c.b * f1);
      }
    });
    m.instanceMatrix.needsUpdate = true;
    tp.needsUpdate = true;
    tc.needsUpdate = true;
  });
  if (!ships.length) return null;
  return (
    <>
      <instancedMesh ref={ref} args={[shipGeo, shipMat, ships.length]} frustumCulled={false} raycast={noRay} />
      <lineSegments geometry={trailGeo} material={trailMat} frustumCulled={false} raycast={noRay} />
    </>
  );
}

// ---- camera: overview, or follow the focused planet ------------------------------------------------------
export function overviewOf(g: Galaxy): { center: THREE.Vector3; dist: number } {
  let lo = Infinity, hi = -Infinity, depth = 0;
  for (const s of g.systems) {
    const reach = s.planets.length ? s.planets[s.planets.length - 1].orbit + 4 : s.shellRadius;
    lo = Math.min(lo, s.x - reach);
    hi = Math.max(hi, s.x + reach);
    depth = Math.max(depth, reach);
  }
  if (!Number.isFinite(lo)) return { center: new THREE.Vector3(), dist: 120 };
  return { center: new THREE.Vector3((lo + hi) / 2, 0, depth * 0.12), dist: Math.max((hi - lo) * 0.92, depth * 2.4) };
}
export const VIEW_DIR = new THREE.Vector3(0, 0.88, 1).normalize();

/** set before a focus change made by the wheel: lock or let go where you are, without flying */
let quiet = false;

function CameraRig({ g }: { g: Galaxy }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const { camera, gl } = useThree();
  const focus = useStore((s) => s.focus);
  const fly = useRef<number | null>(null);
  const glide = useRef(false);
  const ov = useMemo(() => overviewOf(g), [g]);
  const sysOf = useMemo(() => new Map(g.systems.map((s) => [s.faction, s])), [g]);
  useEffect(() => {
    const p = focus ? g.planets.get(focus) : undefined;
    if (quiet) {
      // the wheel locked onto a planet (glide to centre it) or let go of one (stay put)
      quiet = false;
      fly.current = null;
      glide.current = !!p;
      return;
    }
    glide.current = false;
    fly.current = p ? p.radius * (p.ring ? 11 : 8.5) : ov.dist;
  }, [focus, g, ov]);
  useEffect(() => {
    const el = gl.domElement;
    const right = new THREE.Vector3();
    const screen = (p: Planet) => {
      const c = new THREE.Vector3(...planetPos(p, sysOf.get(p.town.faction)!, orbit.sec));
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      const e = c.clone().addScaledVector(right, p.radius).project(camera);
      c.project(camera);
      const r = el.getBoundingClientRect();
      return { x: ((c.x + 1) / 2) * r.width + r.left, y: ((1 - c.y) / 2) * r.height + r.top, px: c.z > 1 ? 0 : (Math.abs(e.x - c.x) * r.width) / 2 };
    };
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState();
      if (e.deltaY < 0 && !st.focus) {
        // zooming in on a planet that is already a fair size: lock onto it so it does not orbit away
        let best: Planet | null = null, bestD = Infinity;
        for (const p of g.planets.values()) {
          const sc = screen(p);
          const d = Math.hypot(sc.x - e.clientX, sc.y - e.clientY);
          if (sc.px > 14 && d < Math.max(sc.px * 1.8, 28) && d < bestD) { best = p; bestD = d; }
        }
        if (best) { quiet = true; st.setFocus(best.key); }
      } else if (e.deltaY > 0 && st.focus && !st.selected) {
        const p = g.planets.get(st.focus);
        if (p && screen(p).px < 8) { quiet = true; st.setFocus(null); }
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, camera, g, sysOf]);
  (window as unknown as { __agentTownFlying?: unknown }).__agentTownFlying = () => fly.current !== null || glide.current;
  useFrame((_, dt) => {
    if (!controls) return;
    const p = focus ? g.planets.get(focus) : undefined;
    const s = p ? sysOf.get(p.town.faction) : undefined;
    const target = p && s ? new THREE.Vector3(...planetPos(p, s, orbit.sec)) : ov.center;
    const smooth = 1 - Math.exp(-dt * 3);
    const k = fly.current !== null || glide.current ? smooth : p ? 1 : 0;
    if (k > 0) {
      const delta = target.clone().sub(controls.target).multiplyScalar(k);
      controls.target.add(delta);
      camera.position.add(delta);
      if (glide.current && p && controls.target.distanceTo(target) < p.radius * 0.02) glide.current = false;
    }
    if (fly.current !== null) {
      const off = camera.position.clone().sub(controls.target);
      const len = off.length() + (fly.current - off.length()) * k;
      camera.position.copy(controls.target).add(off.setLength(len));
      if (Math.abs(len - fly.current) < fly.current * 0.01 && controls.target.distanceTo(target) < 0.05 * (p?.radius ?? 10)) fly.current = null;
    }
    controls.update();
  });
  const fp = focus ? g.planets.get(focus) : undefined;
  return (
    <OrbitControls
      makeDefault enableDamping dampingFactor={0.08} rotateSpeed={0.55} zoomSpeed={0.7} screenSpacePanning
      zoomToCursor={!fp} minDistance={fp ? fp.radius * 1.5 : 1.2} maxDistance={ov.dist * 2.5} target={ov.center}
    />
  );
}

function OrbitClock() {
  useFrame((_, dt) => {
    // the orbits are ambient: they run whatever the time bar does (it stops by itself at its end)
    if (!orbit.frozen) orbit.sec += Math.min(dt, 0.1);
    useStore.getState().advance(Math.min(dt, 0.1) * 1000);
  });
  return null;
}

/**
 * multisampling under the post effects: on a high-density screen the pixels are small enough without
 * it, and it cost space 60 → 34 fps at DPR 2 (M4, 1440×900). `?msaa=N` overrides.
 */
const MSAA = (() => {
  const q = new URLSearchParams(location.search).get("msaa");
  return q !== null ? Number(q) : window.devicePixelRatio >= 1.5 ? 0 : 4;
})();

export function Effects() {
  return (
    <EffectComposer multisampling={MSAA} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={1.05} luminanceThreshold={0.82} luminanceSmoothing={0.22} radius={0.78} />
      <Vignette offset={0.24} darkness={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

export function GalaxyScene({ g }: { g: Galaxy }) {
  return (
    <>
      <Sky />
      <Starfield />
      <ambientLight intensity={0.06} />
      {/* a faint reflection so the kit buildings on a near planet are not black on their night side */}
      <StudioEnvironment intensity={0.3} />
      <hemisphereLight args={["#8fb6ff", "#1a0f22", 0.12]} />
      {g.systems.map((s) => (
        <group key={s.faction}>
          <StarView s={s} />
          <Orbits s={s} />
          {s.planets.map((p) => <PlanetView key={p.key} p={p} s={s} />)}
        </group>
      ))}
      <Ships g={g} />
      <CameraRig g={g} />
      <OrbitClock />
      <Effects />
    </>
  );
}
