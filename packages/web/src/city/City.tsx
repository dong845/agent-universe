// A planet's city (owner 2026-11-01): the town layout on flat ground under its star, with the same
// buildings as on the planet, conveyor belts to the task hall, and the agents at work as small robots
// — the live ones, and a replayed request when one is playing.
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRightPanel } from "../ui/rightPanel.ts";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import { buildTimeline } from "../orchestrator/timeline.ts";
import { absTime, useStore } from "../store.ts";
import { Effects, Emblem, Instanced, StarView, MATS, partsOf, Sky, standing, Starfield, type Frame, type GeomKey, type Part } from "../galaxy/Galaxy.tsx";
import { FACTION_COLOR, type Planet, type StarSystem } from "../galaxy/galaxyData.ts";
import { BELT, NOISE } from "../galaxy/shaders.ts";
import type { TownLayout } from "../v3/townLayout.ts";
import type { World25 } from "../v3/world25Data.ts";
import { cityPlaces } from "./cityData.ts";
import { HistoryFocus, StandingAgents } from "./HistoryPanel.tsx";
import { countsAt, useHistory } from "./history.ts";
import { LAYOUT_DEFAULTS } from "../v3/townLayout.ts";
import { useReplay } from "./cityReplay.ts";
import { Robot, RobotProbe, robotInfo, type RobotInfo } from "./Robot.tsx";
import { Deliveries, Haze, KitBuildings, KitGround, StudioEnvironment } from "./CityKit.tsx";
import { mainOf, uniqueAgents } from "../orchestrator/sessionAgents.ts";

const noRay = () => null;
const UP = new THREE.Vector3(0, 1, 0);
const HEX = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, -0.5, 0);
/** a hex cell's corner radius: neighbouring cells are 2 apart (townLayout.cellPos) */
const CELL_R = 2 / Math.sqrt(3);

export const cityFrame = (unit: number): Frame => (b) => ({
  origin: new THREE.Vector3(b.spot.x, 0, b.spot.z),
  up: UP,
  q: new THREE.Quaternion().setFromAxisAngle(UP, b.turn),
  k: 1 / unit,
});

/** the sun is the faction's star, low in the sky on its own side */
const sunDir = (p: Planet) => new THREE.Vector3(p.town.faction === "codex" ? 1 : -1, 0.62, -0.55).normalize();

/** the planet's own ground beyond the city, fading into the night */
function Terrain({ p, layout }: { p: Planet; layout: TownLayout }) {
  // the ground's noise is broad: computed per vertex of a dense disc, not per pixel (it fills the screen)
  const terrain = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Color(p.look.a) }, uB: { value: new THREE.Color(p.look.b) }, uC: { value: new THREE.Color(p.look.c) }, uR: { value: layout.radius }, uSeed: { value: p.seed } },
    vertexShader: /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uR; uniform float uSeed; varying vec3 vCol;
${NOISE}
void main(){
  vec4 w=modelMatrix*vec4(position,1.0);
  vec2 q=w.xz/uR;
  float h=fbm(vec3(q*1.6,uSeed))*0.5+0.5;
  vec3 col=mix(uA,uB,smoothstep(0.3,0.65,h));
  col=mix(col,uC,smoothstep(0.7,0.85,h)*0.6);
  col*=0.32+0.18*fbm(vec3(q*6.0,uSeed+3.0));
  vCol=col*(1.0-smoothstep(1.4,5.5,length(q)));
  gl_Position=projectionMatrix*viewMatrix*w;
}`,
    fragmentShader: /* glsl */ `varying vec3 vCol; void main(){ gl_FragColor=vec4(vCol,1.0); }`,
  }), [p, layout]);
  const disc = useMemo(() => new THREE.RingGeometry(0.01, layout.radius * 7, 240, 120), [layout]);
  useEffect(() => () => disc.dispose(), [disc]);
  useEffect(() => () => terrain.dispose(), [terrain]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.13, 0]} geometry={disc} material={terrain} raycast={noRay} />
  );
}

function Ground({ p, layout }: { p: Planet; layout: TownLayout }) {
  const tiles = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<THREE.InstancedMesh>(null);
  const cells = layout.cells;
  const streets = cells.filter((c) => c.kind === "street");
  const fac = new THREE.Color(FACTION_COLOR[p.town.faction]);
  useLayoutEffect(() => {
    const m = tiles.current, l = lights.current;
    if (!m) return;
    const mx = new THREE.Matrix4();
    const ground = new THREE.Color(p.look.b).multiplyScalar(0.45);
    const shade: Record<string, THREE.Color> = { lot: new THREE.Color("#2b3342"), plaza: new THREE.Color("#3d485b"), street: new THREE.Color("#1a202b"), grass: ground };
    cells.forEach((c, i) => {
      const x = 2 * (c.q + c.r / 2), z = Math.sqrt(3) * c.r;
      const h = c.kind === "grass" ? 0.05 : c.kind === "street" ? 0.06 : 0.1;
      const v = 0.92 + ((Math.sin(c.q * 12.9898 + c.r * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.16;
      mx.compose(new THREE.Vector3(x, h, z), new THREE.Quaternion(), new THREE.Vector3(CELL_R * 0.985, h, CELL_R * 0.985));
      m.setMatrixAt(i, mx);
      m.setColorAt(i, shade[c.kind].clone().multiplyScalar(v));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (l) {
      streets.forEach((c, i) => {
        const x = 2 * (c.q + c.r / 2), z = Math.sqrt(3) * c.r;
        mx.compose(new THREE.Vector3(x, 0.075, z), new THREE.Quaternion(), new THREE.Vector3(0.12, 0.015, 0.12));
        l.setMatrixAt(i, mx);
        l.setColorAt(i, fac);
      });
      l.instanceMatrix.needsUpdate = true;
      if (l.instanceColor) l.instanceColor.needsUpdate = true;
    }
  }, [cells, streets, p, fac]);
  const tileMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.55, roughness: 0.55 }), []);
  const lightMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false }), []);
  const terrain = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Color(p.look.a) }, uB: { value: new THREE.Color(p.look.b) }, uC: { value: new THREE.Color(p.look.c) }, uR: { value: layout.radius }, uSeed: { value: p.seed } },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uR; uniform float uSeed; varying vec3 vW;
${NOISE}
void main(){
  vec2 q=vW.xz/uR;
  float n=fbm(vec3(q*1.6,uSeed));
  float h=n*0.5+0.5;
  vec3 col=mix(uA,uB,smoothstep(0.3,0.65,h));
  col=mix(col,uC,smoothstep(0.7,0.85,h)*0.6);
  float d=length(q);
  col*=0.32+0.18*fbm(vec3(q*6.0,uSeed+3.0));
  float fade=1.0-smoothstep(1.4,5.5,d);
  gl_FragColor=vec4(col*fade,1.0);
}`,
  }), [p, layout]);
  useEffect(() => () => { tileMat.dispose(); lightMat.dispose(); terrain.dispose(); }, [tileMat, lightMat, terrain]);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} material={terrain} raycast={noRay}>
        <circleGeometry args={[layout.radius * 7, 96]} />
      </mesh>
      <instancedMesh key={cells.length} ref={tiles} args={[HEX, tileMat, cells.length]} receiveShadow raycast={noRay} />
      {streets.length ? <instancedMesh key={`l${streets.length}`} ref={lights} args={[HEX, lightMat, streets.length]} raycast={noRay} /> : null}
    </>
  );
}

function beltRibbons(belts: { a: THREE.Vector3; b: THREE.Vector3; color: string; density: number }[]): THREE.BufferGeometry {
  const pos: number[] = [], s: number[] = [], t: number[] = [], c: number[] = [], den: number[] = [], idx: number[] = [];
  const w = 0.09;
  for (const bt of belts) {
    const d = bt.b.clone().sub(bt.a);
    const len = d.length();
    if (len < 0.5) continue;
    const dir = d.clone().divideScalar(len);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(w);
    const cc = new THREE.Color(bt.color);
    const base = pos.length / 3;
    const n = Math.max(2, Math.ceil(len / 0.5));
    for (let k = 0; k <= n; k++) {
      const m = bt.a.clone().addScaledVector(dir, (k / n) * len);
      pos.push(m.x + side.x, 0.04, m.z + side.z, m.x - side.x, 0.04, m.z - side.z);
      s.push((k / n) * len * 0.35, (k / n) * len * 0.35);
      t.push(1, -1);
      c.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
      den.push(bt.density, bt.density);
      if (k < n) { const v = base + k * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute("aCol", new THREE.Float32BufferAttribute(c, 3));
  g.setAttribute("aDen", new THREE.Float32BufferAttribute(den, 1));
  g.setIndex(idx);
  return g;
}

function Buildings({ p, w }: { p: Planet; w: World25 }) {
  const historyOn = useHistory((s) => s.town === p.key);
  const sig = useStore((s) => {
    const ts = absTime(s.uiT);
    // at a history step a public building stands only if its work had reached the build threshold then
    const work = historyOn && s.w25 && s.historyAt !== null ? countsAt(s.w25, p.key, s.historyAt).work : null;
    return p.blocks.map((b) => (standing(b, ts) && !(work && b.spot.info.kind === "public" && (work[b.spot.info.work] ?? 0) < LAYOUT_DEFAULTS.minWork) ? 1 : 0)).join("");
  });
  const vis = useMemo(() => p.blocks.filter((_, i) => sig[i] === "1"), [p, sig]);
  const groups = useMemo(() => {
    const out = new Map<string, Part[]>();
    for (const x of partsOf(vis, cityFrame(p.unit))) {
      const k = `${x.geom}|${x.mat}`;
      out.set(k, [...(out.get(k) ?? []), x]);
    }
    return out;
  }, [vis, p.unit]);
  const hall = vis.find((b) => b.type === "hall");
  const belts = useMemo(() => {
    if (!hall) return null;
    const h = new THREE.Vector3(hall.spot.x, 0, hall.spot.z);
    const list = vis.flatMap((b) => {
      if (b.type !== "public" && b.type !== "house" && b.type !== "tent") return [];
      const a = new THREE.Vector3(b.spot.x, 0, b.spot.z);
      const i = b.spot.info;
      const density = i.kind === "public" ? 0.6 + Math.log10(Math.max(1, i.count)) * 0.9 : 0.4 + Math.log10(Math.max(1, (i.kind === "house" || i.kind === "tent" ? w.requests.get(i.requestId)?.calls : 1) ?? 1)) * 0.7;
      // from the building's edge to the hall's edge
      const dir = h.clone().sub(a).normalize();
      return [{ a: a.addScaledVector(dir, (b.foot / p.unit) * 0.55), b: h.clone().addScaledVector(dir, -(hall.foot / p.unit) * 0.62), color: b.color, density }];
    });
    return beltRibbons(list);
  }, [vis, hall, w, p.unit]);
  const beltMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: BELT.vertex, fragmentShader: BELT.fragment, uniforms: { uTime: { value: 0 }, uSpeed: { value: p.live ? 1.4 : 0.5 } }, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [p.live]);
  useEffect(() => () => { belts?.dispose(); }, [belts]);
  useEffect(() => () => beltMat.dispose(), [beltMat]);
  useFrame(({ clock }) => {
    beltMat.uniforms.uTime.value = clock.elapsedTime;
    MATS.beam.opacity = 0.22 + 0.14 * Math.sin(clock.elapsedTime * 3);
  });
  const fallback = (
    <>
      {[...groups.entries()].map(([k, parts]) => {
        const [geom, mat] = k.split("|") as [GeomKey, keyof typeof MATS];
        return <Instanced key={k} parts={parts} geom={geom} mat={mat} blocks={vis} town={p.key} onBlock={mat === "hull"} />;
      })}
    </>
  );
  const beams = [...groups.entries()].filter(([k]) => k.endsWith("|beam"));
  return (
    <>
      {/* the Blender kit; the plain shapes stand in while it loads */}
      <Suspense fallback={fallback}><KitBuildings p={p} vis={vis} /></Suspense>
      {beams.map(([k, parts]) => <Instanced key={k} parts={parts} geom={k.split("|")[0] as GeomKey} mat="beam" blocks={vis} town={p.key} onBlock={false} />)}
      {belts ? <mesh geometry={belts} material={beltMat} raycast={noRay} /> : null}
      {hall ? <Emblem faction={p.town.faction} use="badge" scale={0.6} position={[hall.spot.x, (hall.foot / p.unit) * 1.05 + 0.9, hall.spot.z]} speed={0.4} /> : null}
    </>
  );
}

/** the live requests of this town, played on the world clock */
function LiveAgents({ p, layout, w }: { p: Planet; layout: TownLayout; w: World25 }) {
  // at a history step the world is pinned to the past: the step's own agents stand instead
  const history = useHistory((s) => s.town === p.key);
  const events = useStore((s) => s.events);
  const live = useStore((s) => s.live);
  const tl = useMemo(() => {
    const reqs = [...w.requests.values()].filter((r) => `${r.faction}|${r.projectId}` === p.key && w.live.has(r.requestId));
    if (!reqs.length) return null;
    const tasks = new Set(reqs.flatMap((r) => r.taskIds).filter((t) => live.has(t)));
    const evs = events.filter((e): e is AgentTownEvent => !!e.taskId && tasks.has(e.taskId));
    return evs.length ? { tl: buildTimeline(uniqueAgents(evs), cityPlaces(layout, reqs[0].requestId)), reqs } : null;
  }, [events, live, w, p.key, layout]);
  // a replay in this city is the one shown (two main agents side by side read as one too many)
  const replaying = useReplay((s) => s.r?.district === p.key);
  if (!tl || history || replaying) return null;
  const time = () => absTime(useStore.getState().t) - tl.tl.t0;
  // two sessions at work here: each main agent says which request it is on
  const mains = tl.tl.actors.filter((a) => a.kind === "commander");
  const whoOf = (id: string) => {
    if (mains.length < 2) return undefined;
    const title = tl.reqs.find((r) => mainOf(r.sessionId) === id || r.sessionId === id)?.title;
    return title ? (title.length > 14 ? `${title.slice(0, 14)}…` : title) : undefined;
  };
  return <>{tl.tl.actors.map((a) => <Robot key={`live|${a.id}`} id={`live|${a.id}`} actor={a} time={time} faction={p.town.faction} end={tl.tl.roofAt ?? Infinity} who={a.kind === "commander" ? whoOf(a.id) : undefined} />)}</>;
}

/** a replayed request, on the replay's own clock */
function ReplayAgents({ p }: { p: Planet }) {
  const r = useReplay((s) => (s.r && s.r.district === p.key ? s.r : null));
  const tl = r?.tl;
  useFrame((_, dt) => useReplay.getState().tick(Math.min(dt, 0.1) * 1000));
  if (!tl) return null;
  const time = () => useReplay.getState().r?.t ?? 0;
  return <>{tl.actors.map((a) => <Robot key={`rp|${r!.requestId}|${a.id}`} id={`rp|${a.id}`} actor={a} time={time} faction={p.town.faction} end={tl.roofAt ?? Infinity} />)}</>;
}

/** px the right panels take (360 wide, 14 from the edge, plus a gutter): the city's middle moves left by half (D27 B2) */
export const PANEL_PX = 388;

/**
 * While a right panel is open the picture shifts left by half the panel (a camera view offset, eased),
 * so the middle of the city is the middle of what is still visible. Labels and clicks use the same
 * projection; the offset is cleared when the city closes (the galaxy shares this camera).
 */
function PanelShift() {
  const panel = useRightPanel();
  const { camera, size } = useThree();
  const cur = useRef(0);
  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const want = panel ? Math.min(PANEL_PX / 2, size.width * 0.25) : 0;
    const k = 1 - Math.exp(-dt * 6);
    const next = Math.abs(want - cur.current) < 0.5 ? want : cur.current + (want - cur.current) * k;
    const v = cam.view;
    if (next === cur.current && (next === 0 ? !v?.enabled : v?.enabled && v.fullWidth === size.width && v.fullHeight === size.height)) return;
    cur.current = next;
    if (next === 0) cam.clearViewOffset();
    else cam.setViewOffset(size.width, size.height, next, 0, size.width, size.height);
  });
  useEffect(() => () => (camera as THREE.PerspectiveCamera).clearViewOffset(), [camera]);
  (window as unknown as { __cityShift?: () => number }).__cityShift = () => cur.current;
  return null;
}

function CityCamera({ layout }: { layout: TownLayout }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const R = layout.radius;
  const want = useMemo(() => new THREE.Vector3(), []);
  const lost = useRef(0);
  // the camera follows a clicked robot (spec 2026-11-05 C1), else during a replay the main agent (that
  // can be switched off on the replay bar); a followed robot gone for 3 s lets go (a world swap remounts robots)
  useFrame((_, dt) => {
    if (!controls) return;
    const st = useStore.getState();
    let info: RobotInfo | undefined;
    if (st.followAgent) {
      info = robotInfo.get(st.followAgent);
      if (!info?.visible) {
        lost.current += dt;
        if (lost.current > 3) st.setFollowAgent(null);
        return;
      }
      lost.current = 0;
    } else {
      const r = useReplay.getState().r;
      if (!r || !r.follow) return;
      const main = r.tl.actors.find((a) => a.kind === "commander");
      info = main ? robotInfo.get(`rp|${main.id}`) : undefined;
      if (!info?.visible) return;
    }
    want.set(info.anchor.x, 0, info.anchor.z);
    const k = 1 - Math.exp(-dt * 2.5);
    const delta = want.sub(controls.target).multiplyScalar(k);
    controls.target.add(delta);
    camera.position.add(delta);
    // from high enough that buildings do not hide it, near enough to see what it is doing
    const off = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    off.radius += (16 - off.radius) * k * 0.6;
    off.phi += (0.72 - off.phi) * k * 0.6;
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(off));
  });
  useLayoutEffect(() => {
    camera.position.set(R * 0.2, R * 0.95, R * 1.55);
    camera.lookAt(0, 0, 0);
  }, [camera, R]);
  (window as unknown as { __agentTownFlying?: unknown; __cityView?: unknown }).__agentTownFlying = () => false;
  (window as unknown as { __agentTownControls?: unknown }).__agentTownControls = controls;
  // dragging the view yourself lets go of a followed robot (Esc does too: the store's back())
  useEffect(() => {
    const c = controls as unknown as THREE.EventDispatcher<{ start: object }> | null;
    if (!c) return;
    const letGo = () => useStore.getState().setFollowAgent(null);
    c.addEventListener("start", letGo);
    return () => c.removeEventListener("start", letGo);
  }, [controls]);
  // test hook: look from a given direction and distance (screenshots of the sky and the horizon)
  (window as unknown as { __cityView?: unknown }).__cityView = (phi: number, theta: number, dist: number) => {
    if (!controls) return;
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(dist, phi, theta));
    controls.update();
  };
  return <OrbitControls makeDefault enableDamping dampingFactor={0.08} rotateSpeed={0.55} zoomSpeed={0.8} zoomToCursor minDistance={2} maxDistance={R * 3.2} maxPolarAngle={1.36} target={[0, 0, 0]} />;
}

function Clock() {
  useFrame((_, dt) => useStore.getState().advance(Math.min(dt, 0.1) * 1000));
  return null;
}

export function CityScene({ p, layout, w, sys }: { p: Planet; layout: TownLayout; w: World25; sys?: StarSystem }) {
  const sun = useMemo(() => sunDir(p), [p]);
  const R = layout.radius;
  const light = new THREE.Color(FACTION_COLOR[p.town.faction]).lerp(new THREE.Color("#ffffff"), 0.55);
  // the faction's star hangs in the sky with its Dyson shell, as built by now
  const K = 9;
  const far = sun.clone().multiplyScalar(900);
  return (
    <>
      <Sky />
      <Starfield />
      {sys ? <group position={[far.x - sys.x * K, far.y, far.z - sys.z * K]} scale={K}><StarView s={sys} light={false} /></group> : null}
      <hemisphereLight args={["#9cc0ff", "#1a1420", 0.55]} />
      <ambientLight intensity={0.12} />
      <directionalLight
        color={light} intensity={2.4} position={sun.clone().multiplyScalar(R * 2)} castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-R * 1.3} shadow-camera-right={R * 1.3} shadow-camera-top={R * 1.3} shadow-camera-bottom={-R * 1.3} shadow-camera-far={R * 6} shadow-bias={-0.0005}
      />
      <Suspense fallback={<Ground p={p} layout={layout} />}>
        <Terrain p={p} layout={layout} />
        <KitGround p={p} layout={layout} />
      </Suspense>
      <StudioEnvironment />
      <Haze p={p} layout={layout} />
      <Suspense fallback={null}><Deliveries p={p} layout={layout} /></Suspense>
      <Buildings p={p} w={w} />
      <Suspense fallback={null}>
        <LiveAgents p={p} layout={layout} w={w} />
        <ReplayAgents p={p} />
      </Suspense>
      <CityCamera layout={layout} />
      <PanelShift />
      <RobotProbe />
      <HistoryFocus p={p} />
      <Suspense fallback={null}><StandingAgents p={p} /></Suspense>
      <Clock />
      <Effects />
    </>
  );
}

