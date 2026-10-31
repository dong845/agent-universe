// Labels over the 2.5D world (spec v3 8.5): from afar, each town's banner (name, theme, what was made
// there); up close, the public buildings' plain names with counts and the street signs. One DOM
// overlay, placed by one projector inside the canvas; overlapping labels give way to bigger towns.
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { Vector3, type OrthographicCamera } from "three";
import themes from "../../../../config/themes.json" with { type: "json" };
import type { ThemesConfig } from "../../../schema/src/themes.ts";
import { declutter, type LabelBox } from "../ui/format.ts";
import { WORK_NAMES } from "./townLayout.ts";
import type { World25 } from "./world25Data.ts";

/** building names and street signs show once their island is this many pixels across on screen */
export const NEAR_PX = 300;
const T = themes as ThemesConfig;
const themeName = (id: string) => T.themes.find((t) => t.id === id)?.name ?? (id === T.default.id ? T.default.name : id === T.fixed.capital.id ? T.fixed.capital.name : id === T.fixed.outpost.id ? T.fixed.outpost.name : id);

interface L {
  id: string;
  x: number;
  y: number;
  z: number;
  /** a building name or street sign (shown up close); banners show at every zoom */
  near: boolean;
  /** radius of the label's island, for the up-close test */
  r: number;
  priority: number;
  cls: string;
  html: { title: string; sub?: string };
}

const els = new Map<string, HTMLDivElement>();
/** label sizes, measured once: the text never changes while the world is loaded */
const sizes = new Map<string, { w: number; h: number }>();
const v = new Vector3();
/** the area the HUD and the time bar cover: no label goes there */
const RESERVED = (w: number, h: number) => [{ x: w / 2 - 260, y: 0, w: 520, h: 80 }, { x: w / 2 - 470, y: h - 70, w: 940, h: 70 }];

export function labelsOf(w: World25): L[] {
  const out: L[] = [];
  for (const [key, t] of w.towns) {
    const c = w.centers.get(key)!;
    const l = w.layouts.get(key)!;
    const counts = `${t.counts.produced} 件成品 · ${t.counts.investigation} 次调查 · ${t.counts.chat + t.counts.empty} 次问答`;
    const r = l.radius;
    out.push({ id: `town|${key}`, x: c.x, y: 7.5, z: c.z - 2, near: false, r, priority: 1e6 + t.counts.produced, cls: `banner town-${t.kind}`, html: { title: t.name, sub: [t.skillNote, themeName(t.theme), counts].filter(Boolean).join(" · ") } });
    for (const s of l.spots) {
      if (s.info.kind === "public") out.push({ id: `pub|${key}|${s.cell}`, x: c.x + s.x, y: 3, z: c.z + s.z, near: true, r, priority: s.info.count, cls: "label", html: { title: WORK_NAMES[s.info.work] ?? s.info.work, sub: s.info.count.toLocaleString() } });
      if (s.info.kind === "notice") out.push({ id: `notice|${key}`, x: c.x + s.x, y: 2, z: c.z + s.z, near: true, r, priority: 1, cls: "label", html: { title: "问答", sub: String(s.info.chats) } });
    }
    for (const st of l.streets) out.push({ id: `street|${key}|${st.name}`, x: c.x + st.x, y: 0.2, z: c.z + st.z, near: true, r, priority: 0.5, cls: "street", html: { title: `${st.name} 街`, sub: `${st.drawn} 栋${st.minor ? ` · 另有 ${st.minor} 件小改动` : ""}` } });
  }
  return out;
}

/** inside the canvas: projects every label and hides the ones out of band, off screen or covered */
export function LabelProjector25({ labels }: { labels: L[] }) {
  const { camera, size } = useThree();
  (window as unknown as { __agentTownProject?: unknown }).__agentTownProject = (x: number, y: number, z: number) => {
    const p = new Vector3(x, y, z).project(camera);
    return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
  };
  let last = "";
  useFrame(() => {
    const zoom = (camera as OrthographicCamera).zoom;
    // nothing moved: the labels are where they were
    const key = `${camera.position.x.toFixed(3)},${camera.position.z.toFixed(3)},${zoom.toFixed(4)},${size.width},${size.height},${labels.length}`;
    if (key === last) return;
    last = key;
    const crowd: LabelBox[] = RESERVED(size.width, size.height).map((r, i) => ({ id: `reserved${i}`, rect: r, priority: Infinity }));
    for (const l of labels) {
      const el = els.get(l.id);
      if (!el) continue;
      if (l.near && 2 * l.r * zoom < NEAR_PX) {
        el.style.visibility = "hidden";
        continue;
      }
      v.set(l.x, l.y, l.z).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      if (x < -150 || x > size.width + 150 || y < -60 || y > size.height + 60) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      let sz = sizes.get(l.id);
      if (!sz) sizes.set(l.id, (sz = { w: el.offsetWidth, h: el.offsetHeight }));
      const { w, h } = sz;
      crowd.push({ id: l.id, rect: { x: x - w / 2 - 3, y: y - h - 2, w: w + 6, h: h + 4 }, priority: l.priority });
    }
    const keep = declutter(crowd);
    for (const c of crowd) if (!keep.has(c.id) && !c.id.startsWith("reserved")) els.get(c.id)!.style.visibility = "hidden";
  });
  return null;
}

/** outside the canvas: the label elements */
export function Labels25({ labels }: { labels: L[] }) {
  return (
    <div className="labels">
      {labels.map((l) => (
        <div key={l.id} ref={(el) => {
            if (el) els.set(l.id, el);
            else els.delete(l.id);
          }} className={l.cls} data-label={l.id} style={{ visibility: "hidden" }}>
          <b>{l.html.title}</b>
          {l.html.sub ? <span>{l.html.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function useLabels(w: World25 | null): L[] {
  return useMemo(() => (w ? labelsOf(w) : []), [w]);
}

