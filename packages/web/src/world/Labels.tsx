// World-anchored labels as one DOM overlay, placed by a single projector inside the canvas (drei's
// <Html> remounts a React root per label under React 19 and dropped one at startup). Each label has
// a zoom band: town banners while the world is seen from afar, building and scaffold labels once
// the camera is close enough to read them.
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type OrthographicCamera } from "three";
import { BUILDINGS } from "../../../schema/src/world.ts";
import { BUILDING_POS, HALL_BUILDING, SENTRY_BOOTH, WAREHOUSE, type Vec } from "../orchestrator/layout.ts";
import { activeAt, floorsAt } from "../orchestrator/timeline.ts";
import { TIER_NAMES, riverX } from "../orchestrator/worldgen.ts";
import { declutter, type LabelBox } from "../ui/format.ts";
import { useStore, type Runtime } from "../store.ts";
import { DETAIL_ZOOM } from "./Camera.tsx";
import { siteTop } from "./Site.tsx";

interface Anchor {
  x: number;
  y: number;
  z: number;
  minZoom: number;
  maxZoom: number;
  /** labels with a priority give way to higher ones they overlap (town banners in the world view) */
  priority?: number;
}

const anchors = new Map<string, Anchor>();
const elements = new Map<string, HTMLDivElement>();
const v = new Vector3();
const sizes = new WeakMap<HTMLDivElement, { w: number; h: number }>();
const FAR = { minZoom: 0, maxZoom: DETAIL_ZOOM };
const NEAR = { minZoom: DETAIL_ZOOM, maxZoom: Infinity };
const ALWAYS = { minZoom: 0, maxZoom: Infinity };

/** inside the canvas: projects every anchor to the screen and hides labels outside their zoom band */
export function LabelProjector() {
  const { camera, size, scene } = useThree();
  (window as unknown as { __agentTownScene?: unknown; __agentTownCamera?: unknown }).__agentTownScene = scene;
  (window as unknown as { __agentTownCamera?: unknown }).__agentTownCamera = camera;
  // test hook: world point → screen pixel, with the live camera
  (window as unknown as { __agentTownProject?: unknown }).__agentTownProject = (x: number, y: number, z: number) => {
    const p = new Vector3(x, y, z).project(camera);
    return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
  };
  useFrame(() => {
    const zoom = (camera as OrthographicCamera).zoom;
    const crowd: LabelBox[] = [];
    for (const [id, el] of elements) {
      const a = anchors.get(id);
      if (!a) continue;
      if (zoom < a.minZoom || zoom >= a.maxZoom) {
        el.style.visibility = "hidden";
        continue;
      }
      v.set(a.x, a.y, a.z).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const off = x < -200 || x > size.width + 200 || y < -100 || y > size.height + 100;
      el.style.visibility = off ? "hidden" : "visible";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      if (!off && a.priority !== undefined) {
        let s = sizes.get(el);
        if (!s) sizes.set(el, (s = { w: el.offsetWidth, h: el.offsetHeight }));
        crowd.push({ id, rect: { x: x - s.w / 2 - 3, y: y - s.h / 2 - 2, w: s.w + 6, h: s.h + 4 }, priority: a.priority });
      }
    }
    // overlapping banners: the more important town keeps its label
    const keep = declutter(crowd);
    for (const c of crowd) if (!keep.has(c.id)) elements.get(c.id)!.style.visibility = "hidden";
  });
  return null;
}

function bind(id: string, at: Vec & { y: number }, band: { minZoom: number; maxZoom: number }, priority?: number) {
  anchors.set(id, { x: at.x, y: at.y, z: at.z, ...band, priority });
  return (el: HTMLDivElement | null) => {
    if (el) elements.set(id, el);
    else elements.delete(id);
  };
}

function TownLabels({ rt, t }: { rt: Runtime; t: number }) {
  const d = rt.district;
  const o = d.origin;
  const at = (p: Vec, y: number) => ({ x: o.x + p.x, y, z: o.z + p.z });
  const tl = rt.timeline;
  const lt = t - rt.offset;
  const scaffolds = tl ? tl.scaffolds.filter((sc) => lt >= sc.appear && (sc.merge === null || lt < sc.merge)) : [];
  const cloud = tl ? activeAt(tl.clouds, lt) : undefined;
  const top = tl ? siteTop(floorsAt(tl, lt).length) + (tl.roofAt !== null && lt >= tl.roofAt ? 1.2 : 0) : 0;
  const k = d.key;
  return (
    <>
      {BUILDINGS.map((b) => (
        <div key={`${k}b${b.id}`} ref={bind(`${k}|b-${b.id}`, at(BUILDING_POS[b.id], 3.1), NEAR)} className="label" data-label={`b-${b.id}`} data-district={k}>
          {b.name}
          <span className="label-sub">{b.what}</span>
        </div>
      ))}
      <div ref={bind(`${k}|hall`, at(HALL_BUILDING, 3.1), NEAR)} className="label" data-label="hall" data-district={k}>任务大厅</div>
      <div ref={bind(`${k}|booth`, at(SENTRY_BOOTH, 2.3), NEAR)} className="label" data-label="booth" data-district={k}>岗亭</div>
      <div ref={bind(`${k}|warehouse`, at(WAREHOUSE, 2.4), NEAR)} className="label" data-label="warehouse" data-district={k}>仓库</div>
      {scaffolds.map((sc) => {
        const actor = tl!.actors.find((a) => a.id === sc.agentId);
        // below the scaffold, on the open ground in front of it; neighbouring slots alternate depth
        const drop = sc.slot % 2 ? 1.2 : 0;
        return (
          <div key={`${k}s${sc.agentId}`} ref={bind(`${k}|sc-${sc.agentId}`, at(sc.pos, -0.7 - drop), NEAR)} className="bubble" data-label={`scaffold-${sc.agentId}`} data-district={k}>
            {(actor?.agentTask ?? actor?.agentType ?? "子代理").slice(0, 20)}
          </div>
        );
      })}
      {cloud ? (
        <div ref={bind(`${k}|cloud`, at({ x: 0, z: 0 }, top + 3.3), NEAR)} className="tag tag-warn" data-label="cloud" data-district={k}>
          返工：{cloud.file}
        </div>
      ) : null}
    </>
  );
}

/** outside the canvas: every label element */
export function ScreenLabels() {
  const world = useStore((s) => s.world);
  const runtimes = useStore((s) => s.runtimes);
  const detail = useStore((s) => s.detail);
  const t = useStore((s) => s.uiT);
  const t0 = useStore((s) => s.t0);
  return (
    <div className="labels">
      {world.districts.map((d) => {
        const live = runtimes.find((r) => r.district.key === d.key)?.timeline;
        return (
          <div key={d.key} ref={bind(`town|${d.key}`, { x: d.origin.x, y: 4, z: d.origin.z + d.radius }, FAR, (live ? 1e15 : 0) + d.tokens)} className="banner" data-label={`town-${d.key}`}>
            <b>{d.name}</b>
            <span>{TIER_NAMES[d.tier - 1]}</span>
            {live ? <i className="live">施工中</i> : null}
          </div>
        );
      })}
      {(["claude-code", "codex"] as const).map((f) => (
        <div key={f} ref={bind(`cap|${f}`, { x: world.capitals[f].x, y: 0, z: world.capitals[f].z + 9 }, ALWAYS, 1e18)} className={`banner capital cap-${f}`} data-label={`capital-${f}`}>
          <b>{f === "codex" ? "Codex 阵营" : "Claude Code 阵营"}</b>
          <span>任务大厅 · 你</span>
        </div>
      ))}
      {world.bridges.filter((b) => b.at <= t0 + t).map((b) => (
        <div key={b.districts.join()} ref={bind(`bridge|${b.districts.join()}`, { x: riverX(b.a.z), y: 3, z: b.a.z }, ALWAYS)} className="tag" data-label="bridge">
          跨阵营协作 · 推断
        </div>
      ))}
      {runtimes.filter((r) => detail.has(r.district.key)).map((r) => (
        <TownLabels key={r.district.key} rt={r} t={t} />
      ))}
    </div>
  );
}
