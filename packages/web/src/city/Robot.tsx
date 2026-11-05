// An agent in the city: the "大头" character (scripts/models/robot.py, spec 2026-11-05 A). Its eyes and
// antenna tip glow in the faction's colour; its headphones are the faction's colour on a main agent and
// its role's colour on a subagent; its chest light is the colour of the work it is doing now. The face
// screen shows one expression (character/rules.ts faceOf) and blinks; a subagent carries one prop for its
// kind of work (propOf). The code moves the model's own nodes — Body, Head, ArmL, ArmR, FootL, FootR —
// by the timeline's pose.
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Faction } from "../../../schema/src/event.ts";
import character from "../../../../art/character.json" with { type: "json" };
import { faceOf, FACES, PROPS, propOf, workOf, type Face, type Prop } from "../character/rules.ts";
import { sampleActor, type Actor } from "../orchestrator/timeline.ts";
import { Emblem } from "../galaxy/Galaxy.tsx";
import { FACTION_COLOR, WORK_COLOR } from "../galaxy/galaxyData.ts";
import { activityOf } from "./cityData.ts";
import { ROBOT_URL } from "./kit.tsx";
import { visibleRaycast } from "./hit.ts";
import { useStore } from "../store.ts";
import { t as tx } from "../i18n/index.ts";

const noRay = () => null;
const GEO = {
  cube: new THREE.BoxGeometry(0.12, 0.12, 0.12),
  /** what a click on a robot hits: an invisible capsule around the whole figure */
  hit: new THREE.CapsuleGeometry(0.42, 0.5, 4, 12),
  dot: new THREE.SphereGeometry(0.025, 8, 6),
};
/** drawn into nothing (no colour, no depth) but still hit by the pointer */
const HIT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
const glow = (hex: string, k = 1.8) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });
/** the model is about 1.15 units tall; figures stand this many times bigger in the city (A5: ≥ 40 / 28 px) */
export const SCALE = { main: 1.3, sub: 1.0 };
/** the top of the head, in model units (art/character.json head.z + head.h / 2) */
const HEAD_TOP = character.head.z + character.head.h / 2;
/** where the bubble sits over the head, in model units */
const TOP = 1.32;

export interface RobotInfo {
  /** world position of the bubble anchor */
  anchor: THREE.Vector3;
  text: string;
  visible: boolean;
  alert: boolean;
  face: Face;
  prop: Prop | null;
}
/** what each robot shows over its head, for the label overlay, the follow card and the mini window */
export const robotInfo = new Map<string, RobotInfo>();
/** each robot's root and kind, for the size probe */
const robotRoots = new Map<string, { root: THREE.Object3D; kind: "main" | "sub" }>();
/** a main agent's robot now on screen (live first, then a history step's), for the tour */
export function mainRobot(): string | undefined {
  const mains = [...robotRoots].filter(([id, r]) => r.kind === "main" && robotInfo.get(id)?.visible).map(([id]) => id);
  return mains.find((id) => id.startsWith("live|")) ?? mains[0];
}

export function Robot({ id, actor, time, faction, end, label, who }: { id: string; actor: Actor; time: () => number; faction: Faction; end: number; label?: string; who?: string }) {
  const sub = actor.kind === "subagent";
  const roleHex = sub ? WORK_COLOR[actor.baseRole] ?? FACTION_COLOR[faction] : FACTION_COLOR[faction];
  const mats = useMemo(() => ({
    eye: glow(FACTION_COLOR[faction]),
    red: glow("#ff4d4d", 2.2),
    white: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    blush: new THREE.MeshBasicMaterial({ color: "#ff8a9a", toneMapped: false }),
    phones: new THREE.MeshStandardMaterial({ color: roleHex, roughness: 0.4, metalness: 0.05 }),
    chest: glow(roleHex, 2),
    cube: glow("#7fd8ff", 2.4),
  }), [faction, roleHex]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const { scene } = useGLTF(ROBOT_URL);
  // each robot gets its own copy, its coloured parts in its own colours; the rest share the file's materials
  const model = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      const own = { Eye: mats.eye, Red: mats.red, White: mats.white, Blush: mats.blush, Phones: mats.phones, Chest: mats.chest }[name];
      if (own) m.material = own;
      m.castShadow = true;
      m.raycast = noRay;
    });
    return c;
  }, [scene, mats]);
  const parts = useMemo(() => {
    const get = (n: string) => {
      const o = model.getObjectByName(n);
      if (!o) throw new Error(`${ROBOT_URL} has no node "${n}"`);
      return o;
    };
    const faces = new Map<Face, THREE.Object3D>(FACES.map((f) => [f, get(`Face_${f}`)]));
    const props = new Map<Prop, THREE.Object3D>();
    for (const p of PROPS) {
      const o = model.getObjectByName(`PropHead_${p}`) ?? model.getObjectByName(`PropHand_${p}`) ?? model.getObjectByName(`PropBody_${p}`);
      if (!o) throw new Error(`${ROBOT_URL} has no prop "${p}"`);
      props.set(p, o);
    }
    // the normal face's eyes and their shines, squashed for a blink
    const blink: THREE.Object3D[] = [];
    faces.get("normal")!.traverse((o) => { if (o !== faces.get("normal") && /^(Eye|Shine)_/.test(o.name)) blink.push(o); });
    return { body: get("Body"), head: get("Head"), armL: get("ArmL"), armR: get("ArmR"), footL: get("FootL"), footR: get("FootR"), faces, props, blink };
  }, [model]);
  const root = useRef<THREE.Group>(null);
  const hit = useRef<THREE.Mesh>(null);
  // the click target hits only while the robot is shown (three's raycaster ignores `visible`)
  useEffect(() => {
    if (hit.current) hit.current.raycast = visibleRaycast(() => root.current, hit.current);
  }, []);
  const cube = useRef<THREE.Mesh>(null);
  const think = useRef<THREE.Group>(null);
  const prev = useRef<{ x: number; z: number; yaw: number } | null>(null);
  const shown = useRef<{ face: Face | null; prop: Prop | null | undefined; propAt: number; activeAt: number }>({ face: null, prop: undefined, propAt: -Infinity, activeAt: 0 });
  const info = useMemo<RobotInfo>(() => ({ anchor: new THREE.Vector3(), text: "", visible: false, alert: false, face: "normal", prop: null }), []);
  const phase = useMemo(() => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) / 997, [id]);
  useEffect(() => {
    robotInfo.set(id, info);
    return () => void robotInfo.delete(id);
  }, [id, info]);
  useEffect(() => {
    if (!root.current) return;
    robotRoots.set(id, { root: root.current, kind: sub ? "sub" : "main" });
    return () => void robotRoots.delete(id);
  }, [id, sub]);
  // before the first frame every face and prop is hidden, so a robot never flashes all of them at once
  useMemo(() => {
    for (const o of parts.faces.values()) o.visible = false;
    for (const o of parts.props.values()) o.visible = false;
  }, [parts]);

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const t = time();
    const s = sampleActor(actor, t);
    g.visible = s.visible;
    info.visible = s.visible;
    if (!s.visible) return;
    const k = clock.elapsedTime + phase * 10;
    const p = prev.current;
    let yaw = p?.yaw ?? 0;
    if (p && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) > 0.002) yaw = Math.atan2(s.pos.x - p.x, s.pos.z - p.z);
    prev.current = { x: s.pos.x, z: s.pos.z, yaw };
    g.position.set(s.pos.x, 0, s.pos.z);
    g.rotation.y += Math.atan2(Math.sin(yaw - g.rotation.y), Math.cos(yaw - g.rotation.y)) * 0.2;
    const { body, head, armL, armR, footL, footR } = parts;
    const moving = s.pose === "walk" || s.pose === "carry" || s.pose === "report";
    const done = t > end && s.pose === "idle";
    let hover = 0.04 + Math.sin(k * (moving ? 9 : 2.4)) * (moving ? 0.02 : 0.012);
    let lean = moving ? 0.12 : 0;
    let roll = 0;
    let a = Math.sin(k * 2) * 0.08;
    let b = -a;
    let look = Math.sin(k * 0.7) * 0.25;
    if (moving) { a = Math.sin(k * 9) * 0.55; b = -a; look = 0; }
    if (s.pose === "work") { a = -1.25 + Math.sin(k * 14) * 0.35; b = -1.25 + Math.cos(k * 14) * 0.35; look = 0; }
    if (s.pose === "raise_hand") { a = -2.9 + Math.sin(k * 6) * 0.15; b = 0.1; look = 0.3; }
    if (s.pose === "dispatch") { a = -1.5; b = 0.1; }
    if (s.pose === "think") look = Math.sin(k * 1.6) * 0.4;
    if (s.pose === "shake") roll = Math.sin(k * 28) * 0.16;
    if (s.pose === "fall") { lean = -1.3; hover = 0; }
    if (done) { a = -2.6 + Math.sin(k * 8) * 0.3; b = -2.6 - Math.sin(k * 8) * 0.3; hover += Math.abs(Math.sin(k * 5)) * 0.08; }
    body.position.y = hover;
    body.rotation.x = lean;
    body.rotation.z = roll;
    head.rotation.y = look;
    head.rotation.z = s.pose === "think" ? 0.12 : 0;
    armL.rotation.x = a;
    armR.rotation.x = b;
    // little steps while walking
    const step = moving ? Math.sin(k * 9) * 0.035 : 0;
    footL.position.y = 0.12 + Math.max(0, step);
    footR.position.y = 0.12 + Math.max(0, -step);

    // the face: one expression; the normal face blinks every few seconds
    const sh = shown.current;
    if (s.pose !== "idle") sh.activeAt = t;
    const face = faceOf({ pose: s.pose, done, idleMs: t - sh.activeAt });
    if (face !== sh.face) {
      for (const [f, o] of parts.faces) o.visible = f === face;
      sh.face = face;
    }
    const cycle = 3 + phase * 2;
    const closed = (k % cycle) < 0.12;
    for (const o of parts.blink) o.scale.y = closed ? 0.12 : 1;
    // the prop changes slowly (a general subagent's most-used work); checked twice a second
    if (clock.elapsedTime - sh.propAt > 0.5) {
      sh.propAt = clock.elapsedTime;
      const prop = propOf(actor, t);
      if (prop !== sh.prop) {
        for (const [q, o] of parts.props) o.visible = q === prop;
        sh.prop = prop;
        // a subagent's headphones wear the colour of its kind of work (the work behind its prop)
        if (sub) mats.phones.color.set(WORK_COLOR[workOf(actor, t) ?? actor.baseRole] ?? FACTION_COLOR[faction]);
      }
    }
    mats.chest.color.set(WORK_COLOR[s.outfit] ?? roleHex).multiplyScalar(2);

    cube.current!.visible = s.pose === "carry" || s.pose === "report";
    cube.current!.rotation.y = k * 2;
    think.current!.visible = s.pose === "think" || s.pose === "pack";
    think.current!.rotation.y = k * 3;
    const sc = sub ? SCALE.sub : SCALE.main;
    info.anchor.set(s.pos.x, (TOP + hover) * sc, s.pos.z);
    info.text = label ?? `${sub ? tx("follow.sub") : tx("follow.main")}${who ? ` · ${who}` : ""} · ${done ? tx("robot.done") : activityOf(s.pose, s.building, sub)}`;
    info.alert = s.pose === "raise_hand" || face === "error";
    info.face = face;
    info.prop = sh.prop ?? null;
  });

  return (
    <group ref={root} scale={sub ? SCALE.sub : SCALE.main}>
      <primitive object={model} />
      <mesh ref={cube} geometry={GEO.cube} material={mats.cube} position={[0, 0.42, 0.3]} raycast={noRay} />
      <group ref={think} position={[0, 1.36, 0]}>
        {[0, 1, 2].map((i) => <mesh key={i} geometry={GEO.dot} material={mats.eye} position={[Math.cos((i * 2 * Math.PI) / 3) * 0.14, 0, Math.sin((i * 2 * Math.PI) / 3) * 0.14]} raycast={noRay} />)}
      </group>
      {!sub ? <Emblem faction={faction} use="badge" scale={0.1} position={[0, 1.42, 0]} speed={1} /> : null}
      <mesh
        ref={hit} geometry={GEO.hit} material={HIT} position={[0, 0.62, 0]}
        onClick={(e) => { if (e.delta > 5) return; e.stopPropagation(); useStore.getState().setFollowAgent(id); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      />
    </group>
  );
}

/** test hook (spec A5): each visible robot's height on screen in px, and how many faces and props show */
export function RobotProbe() {
  const { camera, size } = useThree();
  useEffect(() => {
    const v = new THREE.Vector3();
    (window as unknown as { __robotSizes?: unknown }).__robotSizes = () => {
      const out: { id: string; kind: "main" | "sub"; px: number; faces: number; props: number; x: number; z: number }[] = [];
      for (const [id, { root, kind }] of robotRoots) {
        if (!root.visible) continue;
        // from the feet to the top of the head (not the antenna, a prop or the emblem)
        root.updateWorldMatrix(true, false);
        const y0 = root.localToWorld(v.set(0, 0, 0)).project(camera).y;
        const y1 = root.localToWorld(v.set(0, HEAD_TOP, 0)).project(camera).y;
        const lo = ((1 - Math.max(y0, y1)) / 2) * size.height, hi = ((1 - Math.min(y0, y1)) / 2) * size.height;
        let faces = 0, props = 0;
        root.traverse((o) => {
          if (o.name.startsWith("Face_") && o.visible) faces++;
          if (o.name.startsWith("Prop") && o.visible) props++;
        });
        root.getWorldPosition(v);
        out.push({ id, kind, px: Math.round(hi - lo), faces, props, x: v.x, z: v.z });
      }
      return out;
    };
  }, [camera, size]);
  return null;
}
