// The workers. Every figure is placed each frame by sampleActor(), the same function the tests
// check, so what is drawn is exactly what the timeline says.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { Role } from "../../../schema/src/event.ts";
import { sampleActor, type Actor } from "../orchestrator/timeline.ts";
import { useStore } from "../store.ts";
import { hoverHandlers } from "./hover.ts";
import { ROLE_COLOR, SUBAGENT, backpackColor } from "./palette.ts";

const SKIN = "#f1c9a5";
const PROP_ROLES: Role[] = ["scout", "smith", "engineer", "inspector", "messenger", "diplomat", "scribe", "painter", "operator", "sentry"];

export function Figures() {
  const actors = useStore((s) => s.timeline.actors);
  return (
    <group>
      {actors.map((a) => (
        <Figure key={a.id} actor={a} />
      ))}
    </group>
  );
}

/** the tool each role carries, held in the right hand (plan "识别特征") */
function Prop({ role }: { role: Role }) {
  switch (role) {
    case "scout": // magnifier
      return (
        <group>
          <mesh position={[0, 0.18, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.12, 0.03, 6, 14]} /><meshStandardMaterial color="#1f2937" /></mesh>
          <mesh position={[0, 0.0, 0]}><cylinderGeometry args={[0.025, 0.025, 0.2, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
        </group>
      );
    case "smith": // hammer
      return (
        <group>
          <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.025, 0.025, 0.36, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
          <mesh position={[0, 0.24, 0]}><boxGeometry args={[0.24, 0.1, 0.1]} /><meshStandardMaterial color="#4b5563" /></mesh>
        </group>
      );
    case "engineer": // wrench
      return (
        <group>
          <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.05, 0.32, 0.03]} /><meshStandardMaterial color="#9ca3af" /></mesh>
          <mesh position={[0, 0.26, 0]}><torusGeometry args={[0.06, 0.025, 6, 10, Math.PI * 1.5]} /><meshStandardMaterial color="#9ca3af" /></mesh>
        </group>
      );
    case "inspector": // clipboard
      return (
        <group>
          <mesh position={[0, 0.12, 0.05]}><boxGeometry args={[0.22, 0.3, 0.02]} /><meshStandardMaterial color="#a16207" /></mesh>
          <mesh position={[0, 0.12, 0.065]}><boxGeometry args={[0.17, 0.22, 0.01]} /><meshStandardMaterial color="#fff" /></mesh>
        </group>
      );
    case "messenger": // satchel
      return <mesh position={[0, -0.05, 0.05]}><boxGeometry args={[0.22, 0.18, 0.1]} /><meshStandardMaterial color="#7c3aed" /></mesh>;
    case "diplomat": // scroll
      return <mesh position={[0, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.05, 0.05, 0.3, 8]} /><meshStandardMaterial color="#fef3c7" /></mesh>;
    case "scribe": // quill
      return <mesh position={[0, 0.15, 0]} rotation={[0, 0, 0.4]}><coneGeometry args={[0.04, 0.38, 6]} /><meshStandardMaterial color="#fafafa" /></mesh>;
    case "painter": // brush
      return (
        <group>
          <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.02, 0.02, 0.32, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
          <mesh position={[0, 0.27, 0]}><coneGeometry args={[0.04, 0.1, 6]} /><meshStandardMaterial color="#db2777" /></mesh>
        </group>
      );
    case "operator": // remote
      return <mesh position={[0, 0.1, 0.03]}><boxGeometry args={[0.1, 0.2, 0.05]} /><meshStandardMaterial color="#0f172a" /></mesh>;
    case "sentry": // spear
      return (
        <group>
          <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.02, 0.02, 0.9, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
          <mesh position={[0, 0.74, 0]}><coneGeometry args={[0.05, 0.14, 6]} /><meshStandardMaterial color="#9ca3af" /></mesh>
        </group>
      );
    default:
      return null;
  }
}

function Figure({ actor }: { actor: Actor }) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const shirt = useRef<MeshStandardMaterial>(null);
  const pack = useRef<Mesh>(null);
  const packMat = useRef<MeshStandardMaterial>(null);
  const props = useRef<Record<string, Group | null>>({});
  const thought = useRef<Group>(null);
  const alarm = useRef<Group>(null);
  const scroll = useRef<Group>(null);
  const hat = useRef<Mesh>(null);
  const prev = useRef({ x: 0, z: 0, heading: 0 });
  const isCommander = actor.kind === "commander";
  const scale = isCommander ? 2.1 : 1.7;

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const t = useStore.getState().t;
    const s = sampleActor(actor, t);
    g.visible = s.visible;
    if (!s.visible) return;
    const now = clock.elapsedTime;
    const moving = s.pose === "walk" || s.pose === "carry" || s.pose === "report";
    const dx = s.pos.x - prev.current.x;
    const dz = s.pos.z - prev.current.z;
    if (moving && Math.hypot(dx, dz) > 1e-4) prev.current.heading = Math.atan2(dx, dz);
    prev.current.x = s.pos.x;
    prev.current.z = s.pos.z;
    g.position.set(s.pos.x, moving ? Math.abs(Math.sin(now * 12)) * 0.08 : 0, s.pos.z);
    g.rotation.y = prev.current.heading;

    shirt.current?.color.set(ROLE_COLOR[s.outfit]);
    for (const r of PROP_ROLES) {
      const p = props.current[r];
      if (p) p.visible = s.outfit === r;
    }
    if (hat.current) hat.current.visible = s.outfit === "engineer";
    packMat.current?.color.set(backpackColor(s.backpack));
    if (pack.current) pack.current.scale.setScalar(s.pose === "pack" ? 0.6 + 0.4 * Math.abs(Math.cos(now * 6)) : 1);
    if (thought.current) thought.current.visible = s.pose === "think";
    if (alarm.current) alarm.current.visible = s.pose === "raise_hand";
    if (scroll.current) scroll.current.visible = s.pose === "report";

    const a = arm.current;
    if (a) {
      a.rotation.x =
        s.pose === "work" ? -0.6 + Math.sin(now * 10) * 0.9
        : s.pose === "raise_hand" ? -Math.PI * 0.95
        : s.pose === "carry" || s.pose === "report" ? -1.1
        : s.pose === "dispatch" ? -1.4
        : moving ? Math.sin(now * 12) * 0.5
        : 0;
    }
    if (head.current) head.current.rotation.y = s.pose === "shake" ? Math.sin(now * 22) * 0.6 : 0;
    if (body.current) {
      const fall = s.pose === "fall" ? Math.sin(Math.min(1, (now * 2) % 1) * Math.PI) : 0;
      body.current.rotation.x = -fall * 1.3;
    }
  });

  // the subagent's task is labelled on its scaffold (fixed slot) so two subagents at one building never overlap
  return (
    <group ref={root} scale={scale} {...hoverHandlers({ kind: "figure", agentId: actor.id })}>
      <group ref={body}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <capsuleGeometry args={[0.24, 0.42, 4, 10]} />
          <meshStandardMaterial ref={shirt} color={ROLE_COLOR[actor.baseRole]} />
        </mesh>
        <group ref={head} position={[0, 1.08, 0]}>
          <mesh castShadow><sphereGeometry args={[0.2, 14, 10]} /><meshStandardMaterial color={SKIN} /></mesh>
          <mesh position={[0.07, 0.03, 0.18]}><sphereGeometry args={[0.025, 6, 6]} /><meshStandardMaterial color="#111" /></mesh>
          <mesh position={[-0.07, 0.03, 0.18]}><sphereGeometry args={[0.025, 6, 6]} /><meshStandardMaterial color="#111" /></mesh>
          <mesh ref={hat} position={[0, 0.1, 0]} visible={false}><sphereGeometry args={[0.22, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#facc15" /></mesh>
        </group>
        {/* backpack = context fill */}
        <mesh ref={pack} position={[0, 0.62, -0.27]} castShadow>
          <boxGeometry args={[0.32, 0.36, 0.16]} />
          <meshStandardMaterial ref={packMat} color={backpackColor(0)} />
        </mesh>
        {isCommander ? (
          <mesh position={[0, 0.55, -0.2]} rotation={[0.12, 0, 0]}>
            <coneGeometry args={[0.36, 0.85, 12, 1, true, Math.PI * 0.6, Math.PI * 0.8]} />
            <meshStandardMaterial color={ROLE_COLOR.commander} side={2} />
          </mesh>
        ) : (
          <mesh position={[0, 0.66, 0.235]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.02, 12]} />
            <meshStandardMaterial color={SUBAGENT} />
          </mesh>
        )}
        <group ref={arm} position={[0.3, 0.8, 0]}>
          <mesh position={[0, -0.18, 0]}><capsuleGeometry args={[0.06, 0.24, 3, 6]} /><meshStandardMaterial color={SKIN} /></mesh>
          <group position={[0, -0.36, 0.05]}>
            {PROP_ROLES.map((r) => (
              <group key={r} ref={(el) => { props.current[r] = el; }} visible={false}>
                <Prop role={r} />
              </group>
            ))}
            <group ref={scroll} visible={false}>
              <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.07, 0.07, 0.34, 8]} /><meshStandardMaterial color="#fde68a" /></mesh>
            </group>
          </group>
        </group>
      </group>
      <group ref={thought} position={[0.35, 1.55, 0]} visible={false}>
        <mesh><sphereGeometry args={[0.2, 10, 8]} /><meshStandardMaterial color="#ffffff" /></mesh>
        <mesh position={[-0.2, -0.22, 0]}><sphereGeometry args={[0.07, 8, 6]} /><meshStandardMaterial color="#ffffff" /></mesh>
      </group>
      <group ref={alarm} position={[0, 1.65, 0]} visible={false}>
        <mesh position={[0, 0.12, 0]}><boxGeometry args={[0.08, 0.26, 0.08]} /><meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.6} /></mesh>
        <mesh position={[0, -0.08, 0]}><sphereGeometry args={[0.05, 8, 6]} /><meshStandardMaterial color="#dc2626" /></mesh>
      </group>
      {/* invisible, simple hit volume (plan: no ray tests against skinned meshes) */}
      <mesh position={[0, 0.7, 0]} visible={false}><cylinderGeometry args={[0.4, 0.4, 1.5, 8]} /></mesh>
    </group>
  );
}
