// Labels in a city: the public buildings' plain names with counts, the hall and notice board, the
// street signs, and over each robot what it is doing now. One DOM overlay placed from inside the
// canvas; robots win overlaps, then the busier buildings.
import { countsAt, useHistory } from "./history.ts";
import { useStore } from "../store.ts";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { declutter, type LabelBox } from "../ui/format.ts";
import type { Planet } from "../galaxy/galaxyData.ts";
import { LAYOUT_DEFAULTS, WORK_NAMES, type TownLayout, streetTitle } from "../v3/townLayout.ts";
import { robotInfo } from "./Robot.tsx";
import { t } from "../i18n/index.ts";

interface CL {
  /** a public building's kind of work, for its count at a history step */
  work?: string;
  id: string;
  cls: string;
  title: string;
  sub?: string;
  at: THREE.Vector3;
  priority: number;
}

export function cityLabelsOf(p: Planet, layout: TownLayout): CL[] {
  const out: CL[] = [];
  for (const b of p.blocks) {
    const i = b.spot.info;
    // the kit pieces stand about 1.2 footprints tall (work towers with their tops ~1.5)
    const top = (b.foot / p.unit) * (i.kind === "public" ? 1.55 : 1.2);
    if (i.kind === "public") out.push({ id: `c-pub|${b.spot.cell}`, cls: "g-tag", title: WORK_NAMES[i.work] ?? i.work, sub: i.count.toLocaleString(), work: i.work, at: new THREE.Vector3(b.spot.x, top + 0.3, b.spot.z), priority: 1000 + i.count });
    if (i.kind === "hall") out.push({ id: "c-hall", cls: "g-tag", title: t("city.hall"), at: new THREE.Vector3(b.spot.x, top + 1.3, b.spot.z), priority: 1e6 });
    if (i.kind === "notice") out.push({ id: "c-notice", cls: "g-tag", title: t("city.qa"), sub: String(i.chats), at: new THREE.Vector3(b.spot.x, top + 0.2, b.spot.z), priority: 500 });
  }
  for (const s of layout.streets) out.push({ id: `c-street|${s.name}`, cls: "g-street", title: streetTitle(s.name), sub: t("city.streetSub", { n: s.drawn }) + (s.minor ? t("city.streetMinor", { n: s.minor }) : ""), at: new THREE.Vector3(s.x, 0.2, s.z), priority: 100 });
  return out;
}

const els = new Map<string, HTMLDivElement>();
/** at most this many robots carry a bubble at once */
const BUBBLES = 24;
const sizes = new Map<string, { w: number; h: number }>();
const RESERVED = (w: number, h: number) => [{ x: w / 2 - 300, y: 0, w: 600, h: 120 }, { x: w / 2 - 470, y: h - 130, w: 940, h: 130 }];

/** inside the canvas: places every label and the robots' bubbles */
export function CityProjector({ labels }: { labels: CL[] }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const crowd: LabelBox[] = RESERVED(size.width, size.height).map((r, i) => ({ id: `reserved${i}`, rect: r, priority: Infinity }));
    const place = (id: string, at: THREE.Vector3, priority: number, measure = true) => {
      const el = els.get(id);
      if (!el) return;
      v.copy(at).project(camera);
      const x = ((v.x + 1) / 2) * size.width, y = ((1 - v.y) / 2) * size.height;
      if (v.z > 1 || x < -150 || x > size.width + 150 || y < -60 || y > size.height + 60) { el.style.visibility = "hidden"; return; }
      el.style.visibility = "visible";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      let sz = measure ? sizes.get(id) : undefined;
      if (!sz) { sz = { w: el.offsetWidth, h: el.offsetHeight }; if (measure) sizes.set(id, sz); }
      crowd.push({ id, rect: { x: x - sz.w / 2 - 3, y: y - sz.h - 2, w: sz.w + 6, h: sz.h + 4 }, priority });
    };
    for (const l of labels) place(l.id, l.at, l.priority);
    // robots come and go: they borrow bubbles from a fixed pool, in order
    let slot = 0;
    for (const r of robotInfo.values()) {
      if (!r.visible || slot >= BUBBLES) continue;
      const id = `bubble|${slot++}`;
      const el = els.get(id);
      if (!el) continue;
      if (el.dataset.text !== r.text) { el.textContent = r.text; el.dataset.text = r.text; }
      el.classList.toggle("alert", r.alert);
      // the text changes, so the size is measured each time
      place(id, r.anchor, 1e9, false);
    }
    for (let i = slot; i < BUBBLES; i++) { const el = els.get(`bubble|${i}`); if (el) el.style.visibility = "hidden"; }
    const keep = declutter(crowd);
    for (const c of crowd) if (!keep.has(c.id) && !c.id.startsWith("reserved")) els.get(c.id)!.style.visibility = "hidden";
  });
  return null;
}

/** outside the canvas: the label elements, and one bubble per robot */
export function CityLabels({ labels }: { labels: CL[] }) {
  // at a history step the counts on the public buildings, the Q&A board and the streets would be
  // today's totals (the record keeps them only as totals): show the names alone
  const history = useHistory((s) => s.town);
  const w25 = useStore((s) => s.w25);
  const at = useStore((s) => s.historyAt);
  const counts = useMemo(() => (history && w25 && at !== null ? countsAt(w25, history, at) : null), [history, w25, at]);
  const subOf = (l: CL) => {
    if (!history) return l.sub;
    // at a history step: the counts as of then; the street counts are today's houses, so none
    if (l.id.startsWith("c-pub|") && counts && l.work) return (counts.work[l.work] ?? 0).toLocaleString();
    if (l.id === "c-notice" && counts) return String(counts.chats);
    if (l.id.startsWith("c-street|")) return undefined;
    return l.sub;
  };
  return (
    <div className="labels">
      {/* at a history step a public building not yet built then has no label either */}
      {labels.filter((l) => !(history && counts && l.work && (counts.work[l.work] ?? 0) < LAYOUT_DEFAULTS.minWork)).map((l) => (
        <div key={l.id} ref={(el) => { if (el) els.set(l.id, el); else els.delete(l.id); }} className={l.cls} data-label={l.id} style={{ visibility: "hidden" }}>
          <b>{l.title}</b>
          {subOf(l) ? <span>{subOf(l)}</span> : null}
        </div>
      ))}
      {Array.from({ length: BUBBLES }, (_, i) => (
        <div key={i} ref={(el) => { if (el) els.set(`bubble|${i}`, el); else els.delete(`bubble|${i}`); }} className="g-bubble" data-label={`bubble|${i}`} data-testid="robot-bubble" style={{ visibility: "hidden" }} />
      ))}
    </div>
  );
}
