// An agent in the city: the Blender hover robot (scripts/models/robot.py). Its eyes, antenna tip and
// ear caps glow in the faction's colour; its chest light and stripes in its role's colour (the main
// agent: the faction's). The code moves the model's own nodes — Body, Head, ArmL, ArmR — by the
// timeline's pose.
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Faction } from "../../../schema/src/event.ts";
import { sampleActor, type Actor } from "../orchestrator/timeline.ts";
import { Emblem } from "../galaxy/Galaxy.tsx";
import { FACTION_COLOR, WORK_COLOR } from "../galaxy/galaxyData.ts";
import { activityOf } from "./cityData.ts";
import { kitMaterial, ROBOT_URL } from "./kit.tsx";

const noRay = () => null;
const GEO = {
  cube: new THREE.BoxGeometry(0.12, 0.12, 0.12),
  dot: new THREE.SphereGeometry(0.025, 8, 6),
};
const glow = (hex: string, k = 2.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });
/** the model is about one unit tall; robots stand this many times bigger in the city */
const SCALE = { main: 1.15, sub: 0.85 };

export interface RobotInfo {
  /** world position of the bubble anchor */
  anchor: THREE.Vector3;
  text: string;
  visible: boolean;
  alert: boolean;
}
/** what each robot shows over its head, for the label overlay */
export const robotInfo = new Map<string, RobotInfo>();

export function Robot({ id, actor, time, faction, end }: { id: string; actor: Actor; time: () => number; faction: Faction; end: number }) {
  const sub = actor.kind === "subagent";
  const roleHex = sub ? WORK_COLOR[actor.baseRole] ?? FACTION_COLOR[faction] : FACTION_COLOR[faction];
  const mats = useMemo(() => ({ visor: glow(FACTION_COLOR[faction], 2.4), chest: glow(roleHex), thrust: glow("#9fe8ff", 2.2), red: glow("#ff4d4d", 3), cube: glow("#7fd8ff", 2.4) }), [faction, roleHex]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const { scene } = useGLTF(ROBOT_URL);
  // each robot gets its own copy, its glowing parts in its own colours
  const model = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      m.material = name === "Visor" ? mats.visor : name === "Chest" || name === "Accent" ? mats.chest : name === "Thrust" ? mats.thrust : kitMaterial(name === "Glass" ? "Glass" : name === "Dark" ? "Dark" : "Hull");
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
    const eyes: THREE.Mesh[] = [];
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material === mats.visor) eyes.push(m); });
    return { body: get("Body"), head: get("Head"), armL: get("ArmL"), armR: get("ArmR"), eyes };
  }, [model, mats]);
  const root = useRef<THREE.Group>(null);
  const cube = useRef<THREE.Mesh>(null);
  const think = useRef<THREE.Group>(null);
  const prev = useRef<{ x: number; z: number; yaw: number } | null>(null);
  const info = useMemo<RobotInfo>(() => ({ anchor: new THREE.Vector3(), text: "", visible: false, alert: false }), []);
  useEffect(() => {
    robotInfo.set(id, info);
    return () => void robotInfo.delete(id);
  }, [id, info]);

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const t = time();
    const s = sampleActor(actor, t);
    g.visible = s.visible;
    info.visible = s.visible;
    if (!s.visible) return;
    const k = clock.elapsedTime + id.length;
    const p = prev.current;
    let yaw = p?.yaw ?? 0;
    if (p && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) > 0.002) yaw = Math.atan2(s.pos.x - p.x, s.pos.z - p.z);
    prev.current = { x: s.pos.x, z: s.pos.z, yaw };
    g.position.set(s.pos.x, 0, s.pos.z);
    g.rotation.y += Math.atan2(Math.sin(yaw - g.rotation.y), Math.cos(yaw - g.rotation.y)) * 0.2;
    const { body, head, armL, armR } = parts;
    const moving = s.pose === "walk" || s.pose === "carry" || s.pose === "report";
    const done = t > end && s.pose === "idle";
    let hover = 0.06 + Math.sin(k * (moving ? 9 : 2.4)) * (moving ? 0.022 : 0.015);
    let lean = moving ? 0.16 : 0;
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
    armL.rotation.x = a;
    armR.rotation.x = b;
    const hurt = s.pose === "fall" || s.pose === "shake";
    for (const e of parts.eyes) e.material = hurt ? mats.red : mats.visor;
    cube.current!.visible = s.pose === "carry" || s.pose === "report";
    cube.current!.rotation.y = k * 2;
    think.current!.visible = s.pose === "think" || s.pose === "pack";
    think.current!.rotation.y = k * 3;
    const sc = sub ? SCALE.sub : SCALE.main;
    info.anchor.set(s.pos.x, (1.2 + hover) * sc, s.pos.z);
    info.text = `${sub ? "子代理" : "主代理"} · ${done ? "完成" : activityOf(s.pose, s.building, sub)}`;
    info.alert = s.pose === "raise_hand" || hurt;
  });

  return (
    <group ref={root} scale={sub ? SCALE.sub : SCALE.main}>
      <primitive object={model} />
      <mesh ref={cube} geometry={GEO.cube} material={mats.cube} position={[0, 0.42, 0.3]} raycast={noRay} />
      <group ref={think} position={[0, 1.08, 0]}>
        {[0, 1, 2].map((i) => <mesh key={i} geometry={GEO.dot} material={mats.visor} position={[Math.cos((i * 2 * Math.PI) / 3) * 0.14, 0, Math.sin((i * 2 * Math.PI) / 3) * 0.14]} raycast={noRay} />)}
      </group>
      {!sub ? <Emblem faction={faction} use="badge" scale={0.12} position={[0, 1.17, 0]} speed={1} /> : null}
    </group>
  );
}
