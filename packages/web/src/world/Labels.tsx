// World-anchored text labels as one DOM overlay. drei's <Html> creates a React root per label and,
// under React 19, remounts each once at startup ("Attempted to synchronously unmount a root…");
// the first label was lost in that race. Here a single projector inside the canvas writes each
// label's screen position straight to its element every frame.
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { BUILDINGS } from "../../../schema/src/world.ts";
import { BUILDING_POS, HALL_BUILDING, SENTRY_BOOTH, WAREHOUSE } from "../orchestrator/layout.ts";
import { activeAt, floorsAt } from "../orchestrator/timeline.ts";
import { useStore } from "../store.ts";
import { siteTop } from "./Site.tsx";

interface Anchor {
  x: number;
  y: number;
  z: number;
}

/** id → world anchor; read by the projector each frame */
const anchors = new Map<string, Anchor>();
/** id → element; filled by ref callbacks */
const elements = new Map<string, HTMLDivElement>();

const STATIC: { id: string; text: string; sub?: string; at: Anchor }[] = [
  ...BUILDINGS.map((b) => ({ id: `b-${b.id}`, text: b.name, sub: b.what, at: { x: BUILDING_POS[b.id].x, y: 3.1, z: BUILDING_POS[b.id].z } })),
  { id: "hall", text: "任务大厅", sub: "你", at: { x: HALL_BUILDING.x, y: 3, z: HALL_BUILDING.z } },
  { id: "booth", text: "岗亭", at: { x: SENTRY_BOOTH.x, y: 2.2, z: SENTRY_BOOTH.z } },
  { id: "warehouse", text: "仓库", sub: "缓存", at: { x: WAREHOUSE.x, y: 2.4, z: WAREHOUSE.z } },
];
for (const s of STATIC) anchors.set(s.id, s.at);

const v = new Vector3();

/** inside the canvas: projects every anchor to the screen */
export function LabelProjector() {
  const { camera, size } = useThree();
  // test hook: world point → screen pixel, with the live camera
  (window as unknown as { __agentTownProject?: unknown }).__agentTownProject = (x: number, y: number, z: number) => {
    const p = new Vector3(x, y, z).project(camera);
    return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
  };
  useFrame(() => {
    for (const [id, el] of elements) {
      const a = anchors.get(id);
      if (!a) continue;
      v.set(a.x, a.y, a.z).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.visibility = "visible"; // hidden until first placed, so nothing flashes at the corner
    }
  });
  return null;
}

function bind(id: string) {
  return (el: HTMLDivElement | null) => {
    if (el) elements.set(id, el);
    else elements.delete(id);
  };
}

/** outside the canvas: the label elements themselves */
export function ScreenLabels() {
  const tl = useStore((s) => s.timeline);
  const t = useStore((s) => s.uiT);
  const scaffolds = tl.scaffolds.filter((sc) => t >= sc.appear && (sc.merge === null || t < sc.merge));
  const cloud = activeAt(tl.clouds, t);
  const top = siteTop(floorsAt(tl, t).length) + (tl.roofAt !== null && t >= tl.roofAt ? 1.2 : 0);
  for (const sc of scaffolds) {
    // below the scaffold, on the open ground in front of it: figures work behind, at the doors,
    // so the label never covers one. Neighbouring slots alternate depth so labels never touch.
    const drop = sc.slot % 2 ? 1.2 : 0;
    anchors.set(`sc-${sc.agentId}`, { x: sc.pos.x, y: -0.7 - drop, z: sc.pos.z });
  }
  anchors.set("cloud", { x: 0, y: top + 3.3, z: 0 });
  return (
    <div className="labels">
      {STATIC.map((s) => (
        <div key={s.id} ref={bind(s.id)} className="label" data-label={s.id}>
          {s.text}
          {s.sub ? <span className="label-sub">{s.sub}</span> : null}
        </div>
      ))}
      {scaffolds.map((sc) => {
        const actor = tl.actors.find((a) => a.id === sc.agentId);
        return (
          <div key={sc.agentId} ref={bind(`sc-${sc.agentId}`)} className="bubble" data-label={`scaffold-${sc.agentId}`}>
            {(actor?.agentTask ?? actor?.agentType ?? "子代理").slice(0, 20)}
          </div>
        );
      })}
      {cloud ? (
        <div ref={bind("cloud")} className="tag tag-warn" data-label="cloud">
          返工：{cloud.file}
        </div>
      ) : null}
    </div>
  );
}
