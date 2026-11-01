// An agent in the city: a small hover robot. Its visor and chest light carry the faction's colour (a
// subagent's chest carries its role's colour); its pose follows the timeline sample.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Faction } from "../../../schema/src/event.ts";
import { sampleActor, type Actor } from "../orchestrator/timeline.ts";
import { Emblem } from "../galaxy/Galaxy.tsx";
import { FACTION_COLOR, WORK_COLOR } from "../galaxy/galaxyData.ts";
import { activityOf } from "./cityData.ts";

const noRay = () => null;
const HULL = new THREE.MeshStandardMaterial({ color: "#e8edf5", metalness: 0.35, roughness: 0.32 });
const DARK = new THREE.MeshStandardMaterial({ color: "#2a3140", metalness: 0.5, roughness: 0.4 });
const GEO = {
  body: new THREE.CapsuleGeometry(0.17, 0.2, 6, 16),
  head: new THREE.SphereGeometry(0.16, 20, 14),
  visor: new THREE.SphereGeometry(0.162, 20, 10, -0.9, 1.8, 1.15, 0.55),
  arm: new THREE.CapsuleGeometry(0.045, 0.16, 4, 8),
  ring: new THREE.TorusGeometry(0.14, 0.025, 8, 24).rotateX(Math.PI / 2),
  antenna: new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6),
  ball: new THREE.SphereGeometry(0.035, 10, 8),
  cube: new THREE.BoxGeometry(0.12, 0.12, 0.12),
  dot: new THREE.SphereGeometry(0.025, 8, 6),
};
const glow = (hex: string, k = 2.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });

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
  const chestHex = sub ? WORK_COLOR[actor.baseRole] ?? FACTION_COLOR[faction] : FACTION_COLOR[faction];
  const mats = useMemo(() => ({ visor: glow(FACTION_COLOR[faction], 2.2), chest: glow(chestHex), thrust: glow("#9fe8ff", 2), red: glow("#ff4d4d", 3), cube: glow("#7fd8ff", 2.4) }), [faction, chestHex]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const visor = useRef<THREE.Mesh>(null);
  const cube = useRef<THREE.Mesh>(null);
  const think = useRef<THREE.Group>(null);
  const prev = useRef<{ x: number; z: number; yaw: number } | null>(null);
  const info = useMemo<RobotInfo>(() => ({ anchor: new THREE.Vector3(), text: "", visible: false, alert: false }), []);
  useEffect(() => {
    robotInfo.set(id, info);
    return () => void robotInfo.delete(id);
  }, [id, info]);

  useFrame(({ clock }) => {
    const g = root.current, b = body.current;
    if (!g || !b) return;
    const t = time();
    const s = sampleActor(actor, t);
    g.visible = s.visible;
    info.visible = s.visible;
    if (!s.visible) return;
    const k = clock.elapsedTime;
    // face where it is going
    const p = prev.current;
    let yaw = p?.yaw ?? 0;
    if (p && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) > 0.002) yaw = Math.atan2(s.pos.x - p.x, s.pos.z - p.z);
    prev.current = { x: s.pos.x, z: s.pos.z, yaw };
    const moving = s.pose === "walk" || s.pose === "carry" || s.pose === "report";
    const hover = 0.22 + Math.sin(k * (moving ? 9 : 2.4) + id.length) * (moving ? 0.025 : 0.018);
    g.position.set(s.pos.x, 0, s.pos.z);
    const dy = Math.atan2(Math.sin(yaw - g.rotation.y), Math.cos(yaw - g.rotation.y));
    g.rotation.y += dy * 0.2;
    b.position.y = hover;
    b.rotation.x = moving ? 0.18 : 0;
    b.rotation.z = 0;
    let armA = Math.sin(k * 2) * 0.08, armB = -armA;
    if (moving) { armA = Math.sin(k * 9) * 0.6; armB = -armA; }
    if (s.pose === "work") { armA = -1.2 + Math.sin(k * 14) * 0.35; armB = -1.2 + Math.cos(k * 14) * 0.35; }
    if (s.pose === "raise_hand") { armA = -2.9 + Math.sin(k * 6) * 0.15; armB = 0.1; }
    if (s.pose === "dispatch") { armA = -1.5; armB = 0.1; }
    if (s.pose === "shake") b.rotation.z = Math.sin(k * 28) * 0.18;
    const done = t > end && s.pose === "idle";
    if (done) { armA = -2.6 + Math.sin(k * 8) * 0.3; armB = -2.6 - Math.sin(k * 8) * 0.3; b.position.y = hover + Math.abs(Math.sin(k * 5)) * 0.08; }
    if (s.pose === "fall") { b.rotation.x = -1.35; b.position.y = 0.12; }
    if (s.pose === "pack") b.position.y = 0.16 + Math.sin(k * 3) * 0.01;
    armL.current!.rotation.x = armA;
    armR.current!.rotation.x = armB;
    visor.current!.material = s.pose === "fall" || s.pose === "shake" ? mats.red : mats.visor;
    cube.current!.visible = s.pose === "carry" || s.pose === "report";
    cube.current!.rotation.y = k * 2;
    think.current!.visible = s.pose === "think" || s.pose === "pack";
    think.current!.rotation.y = k * 3;
    info.anchor.set(s.pos.x, (sub ? 1.75 : 2.45) + hover, s.pos.z);
    info.text = `${sub ? "子代理" : "主代理"} · ${done ? "完成" : activityOf(s.pose, s.building, sub)}`;
    info.alert = s.pose === "raise_hand" || s.pose === "fall" || s.pose === "shake";
  });

  return (
    <group ref={root} scale={sub ? 1.6 : 2.1}>
      <group ref={body}>
        <mesh geometry={GEO.body} material={HULL} position={[0, 0.27, 0]} castShadow raycast={noRay} />
        <mesh geometry={GEO.head} material={HULL} position={[0, 0.6, 0]} castShadow raycast={noRay} />
        <mesh ref={visor} geometry={GEO.visor} material={mats.visor} position={[0, 0.6, 0]} raycast={noRay} />
        <mesh geometry={GEO.cube} material={mats.chest} position={[0, 0.33, 0.165]} scale={[0.9, 0.5, 0.25]} raycast={noRay} />
        <mesh ref={armL} geometry={GEO.arm} material={DARK} position={[-0.21, 0.36, 0]} raycast={noRay} />
        <mesh ref={armR} geometry={GEO.arm} material={DARK} position={[0.21, 0.36, 0]} raycast={noRay} />
        <mesh geometry={GEO.antenna} material={DARK} position={[0, 0.8, 0]} raycast={noRay} />
        <mesh geometry={GEO.ball} material={mats.visor} position={[0, 0.87, 0]} raycast={noRay} />
        <mesh geometry={GEO.ring} material={mats.thrust} position={[0, 0.05, 0]} raycast={noRay} />
        <mesh ref={cube} geometry={GEO.cube} material={mats.cube} position={[0, 0.42, 0.28]} raycast={noRay} />
        <group ref={think} position={[0, 0.98, 0]}>
          {[0, 1, 2].map((i) => <mesh key={i} geometry={GEO.dot} material={mats.visor} position={[Math.cos((i * 2 * Math.PI) / 3) * 0.13, 0, Math.sin((i * 2 * Math.PI) / 3) * 0.13]} raycast={noRay} />)}
        </group>
        {!sub ? <Emblem faction={faction} use="badge" scale={0.13} position={[0, 1.12, 0]} speed={1} /> : null}
      </group>
    </group>
  );
}
