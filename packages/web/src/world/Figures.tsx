// The workers: chunky toy figures. Every figure is placed each frame by sampleActor(), the same
// function the tests check, so what is drawn is exactly what the timeline says. The hat is the
// role's main signal (a silhouette reads at a distance; colour alone does not).
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Color, Group, Material } from "three";
import type { Role } from "../../../schema/src/event.ts";
import { sampleActor, type Actor } from "../orchestrator/timeline.ts";
import { useStore } from "../store.ts";
import { hoverHandlers } from "./hover.ts";
import { useLook } from "./looks.ts";
import { Mat } from "./Mat.tsx";
import { ROLE_COLOR, SUBAGENT, backpackColor } from "./palette.ts";

const ROLES: Role[] = ["commander", "scout", "smith", "engineer", "inspector", "messenger", "diplomat", "scribe", "painter", "operator", "sentry"];

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

function Line({ color, w = 0.025 }: { color: string | null; w?: number }) {
  return color ? <Outlines thickness={w} color={color} /> : null;
}

/** headwear per role */
function Hat({ role, line }: { role: Role; line: string | null }) {
  const c = ROLE_COLOR[role];
  switch (role) {
    case "commander": // crown
      return (
        <group position={[0, 0.27, 0]}>
          <mesh><cylinderGeometry args={[0.2, 0.2, 0.12, 10, 1, true]} /><Mat color="#f5c542" /><Line color={line} w={0.015} /></mesh>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.cos((i / 5) * Math.PI * 2) * 0.19, 0.1, Math.sin((i / 5) * Math.PI * 2) * 0.19]}><coneGeometry args={[0.05, 0.12, 4]} /><Mat color="#f5c542" /></mesh>
          ))}
        </group>
      );
    case "scout": // explorer hat
      return (
        <group position={[0, 0.2, 0]}>
          <mesh><cylinderGeometry args={[0.38, 0.38, 0.03, 20]} /><Mat color="#c8a46b" /><Line color={line} w={0.015} /></mesh>
          <mesh position={[0, 0.08, 0]}><sphereGeometry args={[0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color="#c8a46b" /></mesh>
        </group>
      );
    case "engineer": // hard hat
      return (
        <group position={[0, 0.12, 0]}>
          <mesh><sphereGeometry args={[0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color="#facc15" /><Line color={line} w={0.015} /></mesh>
          <mesh position={[0, 0.0, 0.12]}><boxGeometry args={[0.5, 0.03, 0.3]} /><Mat color="#facc15" /></mesh>
        </group>
      );
    case "inspector": // visor cap
      return (
        <group position={[0, 0.18, 0]}>
          <mesh><sphereGeometry args={[0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color={c} /><Line color={line} w={0.015} /></mesh>
          <mesh position={[0, 0.02, 0.26]} rotation={[0.25, 0, 0]}><boxGeometry args={[0.32, 0.03, 0.2]} /><Mat color={c} /></mesh>
        </group>
      );
    case "diplomat": // top hat
      return (
        <group position={[0, 0.25, 0]}>
          <mesh><cylinderGeometry args={[0.32, 0.32, 0.03, 20]} /><Mat color="#2b2b35" /><Line color={line} w={0.015} /></mesh>
          <mesh position={[0, 0.17, 0]}><cylinderGeometry args={[0.2, 0.2, 0.34, 16]} /><Mat color="#2b2b35" /></mesh>
        </group>
      );
    case "scribe": // beret
    case "painter":
      return (
        <mesh position={[0.04, 0.27, 0]} rotation={[0, 0, -0.25]} scale={[1, 0.35, 1]}>
          <sphereGeometry args={[0.27, 16, 10]} />
          <Mat color={role === "painter" ? "#db2777" : "#3f3f46"} />
          <Line color={line} w={0.015} />
        </mesh>
      );
    case "messenger": // flat cap
      return (
        <group position={[0, 0.2, 0]}>
          <mesh scale={[1, 0.45, 1]}><sphereGeometry args={[0.28, 16, 10]} /><Mat color={c} /><Line color={line} w={0.015} /></mesh>
          <mesh position={[0, -0.02, 0.24]}><boxGeometry args={[0.3, 0.03, 0.16]} /><Mat color={c} /></mesh>
        </group>
      );
    case "operator": // headset
      return (
        <group position={[0, 0.0, 0]}>
          <mesh rotation={[0, 0, 0]}><torusGeometry args={[0.31, 0.03, 6, 16, Math.PI]} /><Mat color="#1f2937" /></mesh>
          <mesh position={[0.3, -0.02, 0]}><sphereGeometry args={[0.07, 8, 8]} /><Mat color="#1f2937" /></mesh>
          <mesh position={[-0.3, -0.02, 0]}><sphereGeometry args={[0.07, 8, 8]} /><Mat color="#1f2937" /></mesh>
        </group>
      );
    case "sentry": // helmet with plume
      return (
        <group position={[0, 0.12, 0]}>
          <mesh><sphereGeometry args={[0.31, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color="#9ca3af" /><Line color={line} w={0.015} /></mesh>
          <mesh position={[0, 0.33, -0.02]}><boxGeometry args={[0.06, 0.16, 0.3]} /><Mat color="#dc2626" /></mesh>
        </group>
      );
    case "smith": // bandana
      return (
        <mesh position={[0, 0.12, 0]} scale={[1, 0.5, 1]}>
          <sphereGeometry args={[0.305, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <Mat color="#b91c1c" />
        </mesh>
      );
  }
}

/** the tool each role holds */
function Tool({ role }: { role: Role }) {
  switch (role) {
    case "scout":
      return (
        <group>
          <mesh position={[0, 0.16, 0]}><torusGeometry args={[0.11, 0.03, 6, 14]} /><Mat color="#1f2937" /></mesh>
          <mesh position={[0, 0.16, 0]}><circleGeometry args={[0.1, 14]} /><Mat color="#bfe3ff" /></mesh>
          <mesh><cylinderGeometry args={[0.025, 0.025, 0.18, 6]} /><Mat color="#78350f" /></mesh>
        </group>
      );
    case "smith":
      return (
        <group>
          <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.03, 0.03, 0.36, 6]} /><Mat color="#78350f" /></mesh>
          <mesh position={[0, 0.24, 0]}><boxGeometry args={[0.26, 0.12, 0.12]} /><Mat color="#4b5563" /></mesh>
        </group>
      );
    case "engineer":
      return (
        <group>
          <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.06, 0.3, 0.04]} /><Mat color="#9ca3af" /></mesh>
          <mesh position={[0, 0.26, 0]}><torusGeometry args={[0.07, 0.03, 6, 10, Math.PI * 1.5]} /><Mat color="#9ca3af" /></mesh>
        </group>
      );
    case "inspector":
      return (
        <group>
          <mesh position={[0, 0.12, 0.05]}><boxGeometry args={[0.24, 0.32, 0.03]} /><Mat color="#a16207" /></mesh>
          <mesh position={[0, 0.12, 0.07]}><boxGeometry args={[0.18, 0.24, 0.01]} /><Mat color="#ffffff" /></mesh>
        </group>
      );
    case "messenger":
      return <mesh position={[0, -0.05, 0.05]}><boxGeometry args={[0.24, 0.2, 0.1]} /><Mat color="#7c3aed" /></mesh>;
    case "diplomat":
      return <mesh position={[0, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.06, 0.06, 0.32, 10]} /><Mat color="#fef3c7" /></mesh>;
    case "scribe":
      return <mesh position={[0, 0.15, 0]} rotation={[0, 0, 0.4]}><coneGeometry args={[0.05, 0.4, 6]} /><Mat color="#fafafa" /></mesh>;
    case "painter":
      return (
        <group>
          <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.022, 0.022, 0.32, 6]} /><Mat color="#78350f" /></mesh>
          <mesh position={[0, 0.27, 0]}><coneGeometry args={[0.045, 0.1, 6]} /><Mat color="#db2777" /></mesh>
        </group>
      );
    case "operator":
      return <mesh position={[0, 0.1, 0.03]}><boxGeometry args={[0.12, 0.22, 0.05]} /><Mat color="#0f172a" /></mesh>;
    case "sentry":
      return (
        <group>
          <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.02, 0.02, 0.95, 6]} /><Mat color="#78350f" /></mesh>
          <mesh position={[0, 0.76, 0]}><coneGeometry args={[0.06, 0.16, 6]} /><Mat color="#9ca3af" /></mesh>
        </group>
      );
    default:
      return null;
  }
}

function Figure({ actor }: { actor: Actor }) {
  const look = useLook();
  const line = look.outline;
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const shirt = useRef<Material>(null);
  const pack = useRef<Group>(null);
  const packMat = useRef<Material>(null);
  const hats = useRef<Record<string, Group | null>>({});
  const tools = useRef<Record<string, Group | null>>({});
  const thought = useRef<Group>(null);
  const alarm = useRef<Group>(null);
  const scroll = useRef<Group>(null);
  const prev = useRef({ x: 0, z: 0, heading: 0 });
  const isCommander = actor.kind === "commander";
  const scale = isCommander ? 1.55 : 1.3;

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const s = sampleActor(actor, useStore.getState().t);
    g.visible = s.visible;
    if (!s.visible) return;
    const now = clock.elapsedTime;
    const moving = s.pose === "walk" || s.pose === "carry" || s.pose === "report";
    const dx = s.pos.x - prev.current.x;
    const dz = s.pos.z - prev.current.z;
    if (moving && Math.hypot(dx, dz) > 1e-4) prev.current.heading = Math.atan2(dx, dz);
    prev.current.x = s.pos.x;
    prev.current.z = s.pos.z;
    const step = Math.sin(now * 13);
    // a little hop and squash on each step, a slow breath when standing
    const hop = moving ? Math.abs(step) * 0.09 : 0;
    g.position.set(s.pos.x, hop, s.pos.z);
    g.rotation.y = prev.current.heading;
    if (body.current) body.current.scale.set(1, moving ? 1 - Math.abs(step) * 0.06 : 1 + Math.sin(now * 2.2) * 0.015, 1);

    (shirt.current as unknown as { color: Color } | null)?.color.set(ROLE_COLOR[s.outfit]);
    (packMat.current as unknown as { color: Color } | null)?.color.set(backpackColor(s.backpack));
    for (const r of ROLES) {
      const h = hats.current[r];
      // the crown belongs to the main commander only, never to a general-purpose subagent
      if (h) h.visible = s.outfit === r && (r !== "commander" || isCommander);
      const tl = tools.current[r];
      if (tl) tl.visible = s.outfit === r && s.pose !== "report";
    }
    if (pack.current) pack.current.scale.setScalar(s.pose === "pack" ? 0.6 + 0.4 * Math.abs(Math.cos(now * 6)) : 1);
    if (thought.current) {
      thought.current.visible = s.pose === "think";
      thought.current.position.y = 1.55 + Math.sin(now * 3) * 0.04;
    }
    if (alarm.current) {
      alarm.current.visible = s.pose === "raise_hand";
      alarm.current.scale.setScalar(1 + Math.abs(Math.sin(now * 6)) * 0.25);
    }
    if (scroll.current) scroll.current.visible = s.pose === "report";
    if (legL.current && legR.current) {
      legL.current.rotation.x = moving ? step * 0.7 : 0;
      legR.current.rotation.x = moving ? -step * 0.7 : 0;
    }
    if (arm.current) {
      arm.current.rotation.x =
        s.pose === "work" ? -0.7 + Math.sin(now * 11) * 0.9
        : s.pose === "raise_hand" ? -Math.PI * 0.95
        : s.pose === "carry" || s.pose === "report" ? -1.2
        : s.pose === "dispatch" ? -1.5
        : moving ? -step * 0.6
        : 0;
    }
    if (head.current) {
      head.current.rotation.y = s.pose === "shake" ? Math.sin(now * 22) * 0.6 : 0;
      head.current.rotation.x = s.pose === "think" ? -0.15 : s.pose === "work" ? 0.18 : 0;
    }
    if (body.current) {
      const fall = s.pose === "fall" ? Math.sin(Math.min(1, (now * 2) % 1) * Math.PI) : 0;
      body.current.rotation.x = -fall * 1.3;
    }
  });

  return (
    <group ref={root} scale={scale} {...hoverHandlers({ kind: "figure", agentId: actor.id })}>
      <group ref={body}>
        {/* legs */}
        <group ref={legL} position={[-0.11, 0.24, 0]}>
          <mesh position={[0, -0.1, 0]} castShadow><capsuleGeometry args={[0.07, 0.12, 3, 8]} /><Mat color="#3f3a4f" /></mesh>
        </group>
        <group ref={legR} position={[0.11, 0.24, 0]}>
          <mesh position={[0, -0.1, 0]} castShadow><capsuleGeometry args={[0.07, 0.12, 3, 8]} /><Mat color="#3f3a4f" /></mesh>
        </group>
        {/* torso: a short rounded barrel */}
        <mesh position={[0, 0.48, 0]} castShadow>
          <capsuleGeometry args={[0.24, 0.16, 6, 14]} />
          <Mat ref={shirt} color={ROLE_COLOR[actor.baseRole]} />
          <Line color={line} />
        </mesh>
        {/* head: big and round */}
        <group ref={head} position={[0, 0.98, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.3, 20, 16]} />
            <Mat color={look.skin} />
            <Line color={line} />
          </mesh>
          <mesh position={[0.1, 0.03, 0.27]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial color="#1b1b1f" /></mesh>
          <mesh position={[-0.1, 0.03, 0.27]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial color="#1b1b1f" /></mesh>
          <mesh position={[0.17, -0.06, 0.22]}><sphereGeometry args={[0.045, 8, 8]} /><meshBasicMaterial color="#f4a3a3" transparent opacity={0.6} /></mesh>
          <mesh position={[-0.17, -0.06, 0.22]}><sphereGeometry args={[0.045, 8, 8]} /><meshBasicMaterial color="#f4a3a3" transparent opacity={0.6} /></mesh>
          {ROLES.map((r) => (
            <group key={r} ref={(el) => { hats.current[r] = el; }} visible={false}>
              <Hat role={r} line={line} />
            </group>
          ))}
        </group>
        {/* backpack = context fill (plan: green < 50 %, yellow, red > 80 %) */}
        <group ref={pack} position={[0, 0.52, -0.25]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.15, 0.12, 4, 10]} />
            <Mat ref={packMat} color={backpackColor(0)} />
            <Line color={line} w={0.02} />
          </mesh>
        </group>
        {isCommander ? (
          <mesh position={[0, 0.5, -0.17]} rotation={[0.18, 0, 0]}>
            <coneGeometry args={[0.34, 0.75, 14, 1, true, Math.PI * 0.6, Math.PI * 0.8]} />
            <meshStandardMaterial color={ROLE_COLOR.commander} side={2} roughness={0.8} />
          </mesh>
        ) : (
          // subagents wear a teal sash: the second colour of the plan
          <mesh position={[0, 0.5, 0]} rotation={[0, 0, 0.7]}>
            <torusGeometry args={[0.255, 0.035, 6, 20]} />
            <Mat color={SUBAGENT} />
          </mesh>
        )}
        <group ref={arm} position={[0.27, 0.6, 0]}>
          <mesh position={[0, -0.12, 0]} castShadow><capsuleGeometry args={[0.065, 0.14, 3, 8]} /><Mat color={look.skin} /></mesh>
          <group position={[0, -0.26, 0.06]}>
            {ROLES.map((r) => (
              <group key={r} ref={(el) => { tools.current[r] = el; }} visible={false}>
                <Tool role={r} />
              </group>
            ))}
            <group ref={scroll} visible={false}>
              <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.08, 0.08, 0.38, 10]} /><Mat color="#fde68a" /></mesh>
            </group>
          </group>
        </group>
      </group>
      <group ref={thought} position={[0.42, 1.55, 0]} visible={false}>
        <mesh><sphereGeometry args={[0.2, 12, 10]} /><meshBasicMaterial color="#ffffff" /><Line color={line} w={0.015} /></mesh>
        <mesh position={[-0.22, -0.24, 0]}><sphereGeometry args={[0.07, 8, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
      </group>
      <group ref={alarm} position={[0, 1.75, 0]} visible={false}>
        <mesh position={[0, 0.14, 0]}><boxGeometry args={[0.1, 0.3, 0.1]} /><meshBasicMaterial color="#ef4444" /></mesh>
        <mesh position={[0, -0.1, 0]}><sphereGeometry args={[0.06, 8, 6]} /><meshBasicMaterial color="#ef4444" /></mesh>
      </group>
      {/* invisible, simple hit volume (plan: no ray tests against detailed meshes) */}
      <mesh position={[0, 0.7, 0]} visible={false}><cylinderGeometry args={[0.45, 0.45, 1.5, 8]} /></mesh>
    </group>
  );
}
