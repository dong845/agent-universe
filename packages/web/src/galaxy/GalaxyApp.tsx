// The star-system view's page: the canvas, labels that follow the moving planets, hover cards, the
// legend and the switch back to the town view.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import themes from "../../../../config/themes.json" with { type: "json" };
import type { ThemesConfig } from "../../../schema/src/themes.ts";
import { useStore, type HoverTarget } from "../store.ts";
import { Diary } from "../ui/Diary.tsx";
import { CardBody } from "../ui/HoverCard.tsx";
import { Hud, TimelineBar } from "../ui/Chrome.tsx";
import { declutter, type LabelBox } from "../ui/format.ts";
import { SpotCard } from "../v3/Cards25.tsx";
import { WORK_NAMES } from "../v3/townLayout.ts";
import { buildGalaxy, panelsAt, planetPos, FACTION_COLOR, PRODUCT_COLOR, WORK_COLOR, type Galaxy } from "./galaxyData.ts";
import { emblemPaths } from "./emblem.ts";
import { GalaxyScene, orbit, overviewOf, SHELL_FACES, spinOf, VIEW_DIR } from "./Galaxy.tsx";
import { absTime } from "../store.ts";

const T = themes as ThemesConfig;
const themeName = (id: string) => T.themes.find((t) => t.id === id)?.name ?? ({ [T.default.id]: T.default.name, [T.fixed.capital.id]: T.fixed.capital.name, [T.fixed.outpost.id]: T.fixed.outpost.name } as Record<string, string>)[id] ?? id;
const KIND_NAMES = { capital: "都城", guild: "技能公会", project: "项目", outpost: "野外营地" } as const;

interface GL {
  id: string;
  cls: string;
  title: string;
  sub?: string;
  priority: number;
  /** world position now */
  at: (v: THREE.Vector3) => THREE.Vector3 | null;
  /** planet key for the up-close labels: shown only when that planet is big on screen */
  near?: string;
  emblem?: "claude-code" | "codex";
}

function labelsOf(g: Galaxy): GL[] {
  const out: GL[] = [];
  const sysOf = new Map(g.systems.map((s) => [s.faction, s]));
  for (const s of g.systems) {
    out.push({ id: `star|${s.faction}`, emblem: s.faction, cls: `g-star f-${s.faction}`, title: s.faction === "codex" ? "Codex 星系" : "Claude Code 星系", sub: `${s.planets.length} 颗行星 · ${s.panels.length} 件成品`, priority: 1e9, at: (v) => v.set(s.x, s.shellRadius * 1.25, s.z) });
  }
  for (const p of g.planets.values()) {
    const s = sysOf.get(p.town.faction)!;
    out.push({ id: `planet|${p.key}`, emblem: p.town.faction, cls: `g-planet f-${p.town.faction}${p.live ? " live" : ""}`, title: p.town.name, sub: `${p.town.counts.produced} 件成品`, priority: 1e6 + p.town.counts.produced, at: (v) => { const [x, y, z] = planetPos(p, s, orbit.sec); return v.set(x, y + p.radius * 1.35, z); } });
    for (const b of p.blocks) {
      const i = b.spot.info;
      if (i.kind !== "public" && i.kind !== "hall") continue;
      const local = new THREE.Vector3(...b.dir).multiplyScalar(p.radius + b.height + b.foot * 0.9);
      out.push({
        id: `blk|${p.key}|${b.spot.cell}`, cls: "g-tag", near: p.key,
        title: i.kind === "hall" ? "任务大厅" : WORK_NAMES[i.work] ?? i.work, sub: i.kind === "public" ? i.count.toLocaleString() : undefined,
        priority: i.kind === "hall" ? 5e5 : i.count,
        at: (v) => { const o = spinOf.get(p.key); return o ? o.localToWorld(v.copy(local)) : null; },
      });
    }
  }
  return out;
}

const els = new Map<string, HTMLDivElement>();
const sizes = new Map<string, { w: number; h: number }>();
const RESERVED = (w: number, h: number) => [{ x: w / 2 - 300, y: 0, w: 600, h: 70 }, { x: w / 2 - 470, y: h - 70, w: 940, h: 70 }];

function Projector({ labels, g }: { labels: GL[]; g: Galaxy }) {
  const { camera, size, scene } = useThree();
  (window as unknown as { __galaxyScene?: unknown }).__galaxyScene = scene;
  const v = useMemo(() => new THREE.Vector3(), []);
  const c = useMemo(() => new THREE.Vector3(), []);
  const e = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    // how big each planet is on screen decides whether its city's labels show
    const px = new Map<string, number>();
    const scr = new Map<string, { x: number; y: number; px: number }>();
    // test hook: where each planet is on screen and how big
    (window as unknown as { __galaxyScreen?: unknown }).__galaxyScreen = scr;
    const sysOf = new Map(g.systems.map((s) => [s.faction, s]));
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    for (const p of g.planets.values()) {
      const [x, y, z] = planetPos(p, sysOf.get(p.town.faction)!, orbit.sec);
      c.set(x, y, z).project(camera);
      e.set(x, y, z).addScaledVector(right, p.radius).project(camera);
      px.set(p.key, c.z > 1 ? 0 : Math.abs(e.x - c.x) * size.width * 0.5);
      scr.set(p.key, { x: ((c.x + 1) / 2) * size.width, y: ((1 - c.y) / 2) * size.height, px: px.get(p.key)! });
    }
    const crowd: LabelBox[] = RESERVED(size.width, size.height).map((r, i) => ({ id: `reserved${i}`, rect: r, priority: Infinity }));
    const camPos = camera.position;
    for (const l of labels) {
      const el = els.get(l.id);
      if (!el) continue;
      if (l.near && (px.get(l.near) ?? 0) < 150) { el.style.visibility = "hidden"; continue; }
      const w = l.at(v);
      if (!w) { el.style.visibility = "hidden"; continue; }
      if (l.near) {
        // a building on the far side of its planet: no label
        const o = spinOf.get(l.near)!;
        const centre = o.getWorldPosition(new THREE.Vector3());
        if (w.clone().sub(centre).dot(camPos.clone().sub(w)) < 0) { el.style.visibility = "hidden"; continue; }
      }
      if (!l.near && l.id.startsWith("planet|") && (px.get(l.id.slice(7)) ?? 0) < 1.2) { el.style.visibility = "hidden"; continue; }
      w.project(camera);
      if (w.z > 1) { el.style.visibility = "hidden"; continue; }
      const x = ((w.x + 1) / 2) * size.width, y = ((1 - w.y) / 2) * size.height;
      if (x < -150 || x > size.width + 150 || y < -60 || y > size.height + 60) { el.style.visibility = "hidden"; continue; }
      el.style.visibility = "visible";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      let sz = sizes.get(l.id);
      if (!sz) sizes.set(l.id, (sz = { w: el.offsetWidth, h: el.offsetHeight }));
      crowd.push({ id: l.id, rect: { x: x - sz.w / 2 - 3, y: y - sz.h - 2, w: sz.w + 6, h: sz.h + 4 }, priority: l.near ? l.priority + 2e9 : l.priority });
    }
    const keep = declutter(crowd);
    for (const k of crowd) if (!keep.has(k.id) && !k.id.startsWith("reserved")) els.get(k.id)!.style.visibility = "hidden";
  });
  return null;
}

const PATHS = { "claude-code": emblemPaths("claude-code"), codex: emblemPaths("codex") };
function Badge({ f }: { f: "claude-code" | "codex" }) {
  return (
    <svg className="g-badge" viewBox="0 0 24 24" aria-hidden="true" style={{ color: FACTION_COLOR[f] }}>
      {PATHS[f].map((d, i) => <path key={i} d={d} fill="currentColor" fillRule="evenodd" />)}
    </svg>
  );
}

/** back to the whole sky, and which planet the camera is on */
function FocusBar({ g }: { g: Galaxy }) {
  const focus = useStore((s) => s.focus);
  const p = focus ? g.planets.get(focus) : undefined;
  if (!p) return <div className="g-hint">滚轮对着行星放大会锁定跟随 · 拖动旋转 · 右键平移</div>;
  return (
    <div className="g-focus">
      <button onClick={() => { const st = useStore.getState(); st.select(null); st.setFocus(null); }} data-testid="g-overview">← 回到全景</button>
      <span><Badge f={p.town.faction} />{p.town.name}</span>
    </div>
  );
}

function Labels({ labels }: { labels: GL[] }) {
  return (
    <div className="labels">
      {labels.map((l) => (
        <div key={l.id} ref={(el) => { if (el) els.set(l.id, el); else els.delete(l.id); }} className={l.cls} data-label={l.id} style={{ visibility: "hidden" }}>
          <b>{l.emblem ? <Badge f={l.emblem} /> : null}{l.title}</b>
          {l.sub ? <span>{l.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

function PlanetCard({ district, g }: { district: string; g: Galaxy }) {
  const p = g.planets.get(district);
  if (!p) return null;
  const t = p.town;
  return (
    <div data-testid="planet-card">
      <h4>{t.name}<small>{KIND_NAMES[t.kind]}</small></h4>
      {t.skillNote ? <div className="muted">{t.skillNote}</div> : null}
      <div className="row"><span>主题</span><b>{themeName(t.theme)}</b></div>
      <div className="row"><span>成品</span><b>{t.counts.produced} 件</b></div>
      <div className="row"><span>调查</span><b>{t.counts.investigation} 次</b></div>
      <div className="row"><span>问答</span><b>{t.counts.chat + t.counts.empty} 次</b></div>
      <div className="muted">行星大小 = 成品数{p.ring ? " · 光环 = 成品满 40 件" : ""} · 点击飞过去</div>
    </div>
  );
}

function GalaxyHoverCard({ g }: { g: Galaxy }) {
  const hovered = useStore((s) => s.hovered);
  const pointer = useStore((s) => s.pointer);
  const [shown, setShown] = useState<HoverTarget | null>(null);
  useEffect(() => {
    if (!hovered) return setShown(null);
    const id = setTimeout(() => setShown(hovered), 150);
    return () => clearTimeout(id);
  }, [hovered]);
  if (!shown) return null;
  return (
    <div className="card" data-testid="hover-card" style={{ left: pointer.x > window.innerWidth - 320 ? pointer.x - 296 : pointer.x + 16, top: pointer.y > window.innerHeight - 300 ? Math.max(8, pointer.y - 280) : pointer.y + 16 }}>
      {shown.kind === "spot" ? <SpotCard district={shown.district} spot={shown.spot} /> : shown.kind === "district" ? <PlanetCard district={shown.district} g={g} /> : <CardBody target={shown} />}
    </div>
  );
}

function ShellMeter({ g }: { g: Galaxy }) {
  const t = useStore((s) => s.uiT);
  return (
    <div className="g-meter">
      {g.systems.map((s) => {
        const n = panelsAt(s, absTime(t));
        return (
          <div key={s.faction}>
            <span>{s.faction === "codex" ? "Codex" : "Claude Code"} 戴森壳</span>
            <i><em style={{ width: `${Math.min(100, (n / SHELL_FACES) * 100)}%`, background: FACTION_COLOR[s.faction] }} /></i>
            <b>{Math.min(n, SHELL_FACES)} / {SHELL_FACES} 片{n > SHELL_FACES ? "（已满）" : ""}</b>
          </div>
        );
      })}
    </div>
  );
}

const sw = (c: string) => <i className="sw" style={{ background: c }} />;
function Legend() {
  const [open, setOpen] = useState(true);
  if (!open) return <button className="legend g-legend g-legend-min" onClick={() => setOpen(true)} data-testid="legend">怎么看 ▸</button>;
  return (
    <div className="legend g-legend" data-testid="legend">
      <b>怎么看</b><button className="g-x" onClick={() => setOpen(false)} aria-label="收起">收起</button>
      <div>恒星 = 一方：左 Claude Code，右 Codex · 戴森壳每亮一片 = 一件成品</div>
      <div>行星 = 一个项目或技能公会，越大成品越多 · 有光环 = 成品满 40 件</div>
      <div>方楼 = 主要成品，灯带颜色是种类：{sw(PRODUCT_COLOR.code)}代码 {sw(PRODUCT_COLOR.docs)}文档 {sw(PRODUCT_COLOR.slides)}幻灯 {sw(PRODUCT_COLOR.image)}图片 {sw(PRODUCT_COLOR.video)}影音 {sw(PRODUCT_COLOR.data)}数据</div>
      <div>圆塔 = 一类工作（{sw(WORK_COLOR.scout)}读代码 {sw(WORK_COLOR.smith)}改代码 {sw(WORK_COLOR.engineer)}跑命令 {sw(WORK_COLOR.inspector)}测试…）· 雷达罩 = 大的调查 · 尖塔 = 地标 · 六角 = 任务大厅</div>
      <div>传送带光点 = 工具调用，越密次数越多 · 光束 = 正在进行 · 飞船 = 同一会话在两个项目间切换</div>
    </div>
  );
}

const Q = new URLSearchParams(location.search);
const DPR: [number, number] = Q.has("dpr") ? [1, Number(Q.get("dpr"))] : [1, 2];

export function ViewSwitch({ to }: { to: "galaxy" | "town" }) {
  const href = () => {
    const q = new URLSearchParams(location.search);
    if (to === "galaxy") q.set("view", "galaxy");
    else q.delete("view");
    const s = q.toString();
    return `${location.pathname}${s ? `?${s}` : ""}`;
  };
  return <a className="view-switch" href={href()} data-testid="view-switch">{to === "galaxy" ? "切到星系视图" : "切到小镇视图"}</a>;
}

export function GalaxyApp() {
  const source = useStore((s) => s.source);
  const w = useStore((s) => s.w25);
  const g = useMemo(() => (w ? buildGalaxy(w) : null), [w]);
  const labels = useMemo(() => (g ? labelsOf(g) : []), [g]);
  const ov = useMemo(() => (g ? overviewOf(g) : null), [g]);
  if (!g || !ov) return null;
  // test hook: planet keys, biggest first
  (window as unknown as { __galaxyKeys?: string[] }).__galaxyKeys = [...g.planets.values()].sort((a, b) => b.town.counts.produced - a.town.counts.produced).map((p) => p.key);
  const cam = ov.center.clone().addScaledVector(VIEW_DIR, ov.dist);
  return (
    <div className="app galaxy" onPointerMove={(e) => useStore.getState().setPointer(e.clientX, e.clientY)}>
      <Canvas flat dpr={DPR} gl={{ antialias: false, powerPreference: "high-performance" }} camera={{ position: [cam.x, cam.y, cam.z], fov: 38, near: 0.05, far: 12000 }}>
        <GalaxyScene g={g} />
        <Projector labels={labels} g={g} />
      </Canvas>
      <Labels labels={labels} />
      <Hud />
      <div className="demo-badge" data-testid="source-badge">{source === "real" ? "真实数据 · 仅本机" : "演示数据：模拟的世界与任务，不是你的真实会话"}</div>
      <ViewSwitch to="town" />
      <ShellMeter g={g} />
      <FocusBar g={g} />
      <Legend />
      <GalaxyHoverCard g={g} />
      <Diary />
      <TimelineBar />
    </div>
  );
}
