// The star-system view's page: the canvas, labels that follow the moving planets, hover cards, the
// legend and the switch back to the town view.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { t, useLang } from "../i18n/index.ts";
import { Search } from "../ui/Search.tsx";
import { MiniWindow } from "../ui/MiniWindow.tsx";
import { FrameGrab } from "../share/grab.ts";
import { PosterButton } from "../share/PosterDialog.tsx";
import { useRightPanel } from "../ui/rightPanel.ts";
import { FollowCard } from "../city/FollowCard.tsx";
import { TourHighlightCity, TourHighlightSpace } from "./TourHighlight.tsx";
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
import { buildGalaxy, MIN_PRODUCED, panelsAt, planetPos, FACTION_COLOR, PRODUCT_COLOR, WORK_COLOR, type Galaxy } from "./galaxyData.ts";
import { NEUTRAL_MARKS } from "./emblem.ts";
import { CityScene } from "../city/City.tsx";
import { CityLabels, CityProjector, cityLabelsOf } from "../city/CityLabels.tsx";
import { cityTowns, REPLAY_SPEEDS, useEnter, useReplay } from "../city/cityReplay.ts";
import { GalaxyScene, orbit, overviewOf, SHELL_FACES, spinOf, VIEW_DIR } from "./Galaxy.tsx";
import { absTime } from "../store.ts";
import { NeedsYou, Toast } from "../ui/NeedsYou.tsx";
import { Settings } from "../ui/Settings.tsx";
import { RecordDialog, RecordHost, useRecordUi } from "../share/RecordDialog.tsx";
import { ExportShare } from "../share/ExportDialog.tsx";
import { ShareReplays } from "../share/ShareReplays.tsx";
import { Tour } from "../ui/Tour.tsx";
import { closeHistory, goToStep, HistoryPanel } from "../city/HistoryPanel.tsx";
import { historySteps, useHistory } from "../city/history.ts";

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
let lastCamera: THREE.Camera | null = null;
let lastSize = { w: 0, h: 0 };

/** test hook: standing houses and tents facing the camera, with the screen point at their middle */
function spotsOnScreen(g: Galaxy, town?: string) {
  if (!lastCamera) return [];
  const ts = absTime(useStore.getState().t);
  const out: { town: string; kind: string; requestId: string; x: number; y: number }[] = [];
  const cam = lastCamera.getWorldPosition(new THREE.Vector3());
  for (const p of g.planets.values()) {
    if (town && p.key !== town) continue;
    const o = spinOf.get(p.key);
    if (!o) continue;
    const centre = o.getWorldPosition(new THREE.Vector3());
    for (const b of p.blocks) {
      const i = b.spot.info;
      if (i.kind !== "house" && i.kind !== "tent") continue;
      if ((b.from !== undefined && b.from > ts) || (b.until !== undefined && b.until <= ts)) continue;
      const w = o.localToWorld(new THREE.Vector3(...b.dir).multiplyScalar(p.radius + b.height * 0.5));
      if (w.clone().sub(centre).normalize().dot(cam.clone().sub(w).normalize()) < 0.25) continue;
      w.project(lastCamera);
      if (w.z > 1) continue;
      out.push({ town: p.key, kind: i.kind, requestId: i.requestId, x: ((w.x + 1) / 2) * lastSize.w, y: ((1 - w.y) / 2) * lastSize.h });
    }
  }
  return out;
}
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
    lastCamera = camera;
    lastSize = { w: size.width, h: size.height };
    for (const k of crowd) if (!keep.has(k.id) && !k.id.startsWith("reserved")) els.get(k.id)!.style.visibility = "hidden";
  });
  return null;
}

export function Badge({ f }: { f: "claude-code" | "codex" }) {
  const share = useStore((s) => s.share);
  const official = useStore((s) => s.logos[f]);
  const neutral = share || !official;
  const m = neutral ? NEUTRAL_MARKS[f] : official.mark;
  return (
    <svg className="g-badge" viewBox={m.viewBox} aria-hidden="true" style={{ color: FACTION_COLOR[f] }}>
      {m.paths.map((d, i) => <path key={i} d={d} fill="currentColor" fillRule={neutral ? "evenodd" : undefined} />)}
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
      {g.systems.some((s) => s.hidden) ? <small data-testid="hidden-note">另有 {g.systems.reduce((a, s) => a + s.hidden, 0)} 个小项目未显示（成品不到 {MIN_PRODUCED} 件），仍计入戴森壳</small> : null}
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

/** `?fps=1`: frames per second and the slowest frames, measured in this browser */
function FpsMeter() {
  const [text, setText] = useState("");
  useEffect(() => {
    let raf = 0, last = performance.now();
    const gaps: number[] = [];
    const tick = (now: number) => {
      gaps.push(now - last);
      last = now;
      if (gaps.length >= 120) {
        const s = [...gaps].sort((a, b) => a - b);
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        setText(`${(1000 / mean).toFixed(0)} fps · p95 ${s[Math.floor(s.length * 0.95)].toFixed(1)} ms · DPR ${devicePixelRatio}`);
        gaps.length = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="g-fps" data-testid="fps">{text || "测量中…"}</div>;
}

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** the bar over a replayed request: play/pause, speed, position, close */
function ReplayBar() {
  const r = useReplay((s) => s.r);
  // in share mode the bar shows the masked title too (the world copy holds it)
  const shown = useStore((s) => (r && s.share ? s.w25?.requests.get(r.requestId)?.title : undefined));
  const recording = useRecordUi((s) => s.running);
  if (!r) return null;
  const title = shown ?? r.title;
  const end = r.tl.duration;
  return (
    <div className="g-replay" data-testid="replay-bar">
      <span className="tag">重放</span>
      <b title={title}>{title}</b>
      <button onClick={() => useReplay.getState().toggle()} aria-label={r.playing ? "暂停" : "播放"}>{r.playing ? "❚❚" : "▶"}</button>
      <button onClick={() => useReplay.getState().next()} title="跳到下一步动作" data-testid="replay-next">⏭ 下一步</button>
      <select value={r.speed} onChange={(e) => useReplay.getState().setSpeed(Number(e.target.value))} aria-label="重放倍速">
        {REPLAY_SPEEDS.map((x) => <option key={x} value={x}>{x}×</option>)}
      </select>
      <input type="range" min={0} max={Math.max(1, end)} step={100} value={Math.min(r.t, end)} onChange={(e) => useReplay.getState().seek(Number(e.target.value))} aria-label="重放进度" />
      <span className="time" title={r.cut ? `长于 5 秒的空闲已压缩，共省去 ${mmss(r.cut)}` : undefined}>{mmss(Math.min(r.t, end))} / {mmss(end)}{r.cut ? " · 已压缩空闲" : ""}</span>
      <label className="follow"><input type="checkbox" checked={r.follow} onChange={(e) => useReplay.getState().setFollow(e.target.checked)} />跟随</label>
      <button onClick={() => useRecordUi.getState().open()} disabled={recording} data-testid="rec-open" title="把这次重放录成视频或动图">● 录制</button>
      <button onClick={() => useReplay.getState().stop()} aria-label="结束重放">✕</button>
    </div>
  );
}

/** top of a city: back to space, which town this is, and whether anyone is working */
function CityBar({ g, onLeave }: { g: Galaxy; onLeave: () => void }) {
  const city = useStore((s) => s.city);
  const history = useHistory((s) => !!s.town);
  const w = useStore((s) => s.w25);
  const p = city ? g.planets.get(city) : undefined;
  if (!p || !w) return null;
  const live = [...w.requests.values()].filter((r) => `${r.faction}|${r.projectId}` === p.key && w.live.has(r.requestId)).length;
  const steps = historySteps(w, p.key);
  return (
    <div className="g-focus g-citybar">
      <button onClick={onLeave} data-testid="leave-city">← 返回太空</button>
      <span><Badge f={p.town.faction} />{p.town.name}<small>{themeName(p.town.theme)} · {p.town.faction === "codex" ? "Codex" : "Claude Code"}</small></span>
      <em>{live ? `${live} 个请求正在进行` : history ? "历史：点一栋房子跳到它那一步" : "现在没有进行中的请求 · 点一栋房子可以重放那次请求"}</em>
      {!history && steps.length ? <button className="g-history-btn" data-testid="history-open" onClick={() => { useHistory.getState().open(p.key, steps.length); goToStep(steps, steps.length); }}>⟲ 历史</button> : null}
    </div>
  );
}

/** the city's legend starts folded (spec 2026-11-05 B2); the user's own choice is remembered */
const CITY_LEGEND = "agent-universe:city-legend";
function CityLegend() {
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(CITY_LEGEND) === "open";
    } catch {
      return false;
    }
  });
  const setOpen = (o: boolean) => {
    setOpenState(o);
    try {
      localStorage.setItem(CITY_LEGEND, o ? "open" : "closed");
    } catch {
      // not remembered
    }
  };
  if (!open) return <button className="legend g-legend g-legend-min" onClick={() => setOpen(true)} data-testid="legend">怎么看 ▸</button>;
  return (
    <div className="legend g-legend g-legend-city" data-testid="legend">
      <b>城里怎么看</b><button className="g-x" onClick={() => setOpen(false)} aria-label="收起">收起</button>
      <div>小机器人 = 正在干活的代理：面罩是阵营色，头顶有阵营徽标的是主代理；小一号的是子代理，胸灯是它的工种色</div>
      <div>头顶的字 = 它此刻在做什么；它走到哪栋圆塔，就是在用哪类工具（读代码、跑命令、测试…）</div>
      <div>圆塔 = 一类工作的地方 · 方楼 = 主要成品 · 雷达罩 = 大的调查 · 六角 = 任务大厅 · 光束 = 正在进行</div>
      <div>传送带光点 = 工具调用 · 点一栋方楼 → 任务日记 → 「在城里重放这次请求」</div>
    </div>
  );
}

/** no logs were found (spec 2026-11-05 B3): where Agent Universe looks, in a card that can be closed */
function EmptyLogsCard({ where }: { where: { claude: string; codex: string } }) {
  useLang();
  const [shut, setShut] = useState(false);
  if (shut) return null;
  return (
    <div className="g-empty" data-testid="empty-logs" role="note">
      <button className="g-x" onClick={() => setShut(true)} data-testid="empty-logs-close" aria-label={t("common.close")}>×</button>
      <b>{t("empty.title")}</b>
      <p>{t("empty.body")}</p>
      <code>{where.claude}</code><small>Claude Code</small>
      <code>{where.codex}</code><small>Codex</small>
    </div>
  );
}

export function GalaxyApp() {
  const source = useStore((s) => s.source);
  const toolsSide = useRightPanel();
  const emptyLogs = useStore((s) => s.emptyLogs);
  const w = useStore((s) => s.w25);
  const city = useStore((s) => s.city);
  const entering = useEnter((s) => s.entering);
  const [fade, setFade] = useState(false);
  const g = useMemo(() => (w ? buildGalaxy(w) : null), [w]);
  const labels = useMemo(() => (g ? labelsOf(g) : []), [g]);
  const ov = useMemo(() => (g ? overviewOf(g) : null), [g]);
  const cp = city && g ? g.planets.get(city) : undefined;
  const cityLayout = cp && w ? w.layouts.get(cp.key) : undefined;
  const cityLabels = useMemo(() => (cp && cityLayout ? cityLabelsOf(cp, cityLayout) : []), [cp, cityLayout]);
  // a planet was clicked: fly there, fade, open its city
  useEffect(() => {
    if (!entering) return;
    const a = setTimeout(() => setFade(true), 800);
    const b = setTimeout(() => {
      useStore.getState().setCity(entering);
      useEnter.getState().clear();
      setTimeout(() => setFade(false), 80);
    }, 1080);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [entering]);
  // a replay belongs to its city
  useEffect(() => {
    const r = useReplay.getState().r;
    if (r && r.district !== city) useReplay.getState().stop();
  }, [city]);
  // a city with nothing running opens on its history, at the latest step; leaving closes it
  useEffect(() => {
    if (!city) return closeHistory();
    const st = useStore.getState();
    const w25 = st.w25;
    if (!w25 || useReplay.getState().r) return;
    const live = [...w25.requests.values()].some((r) => `${r.faction}|${r.projectId}` === city && w25.live.has(r.requestId));
    const steps = historySteps(w25, city);
    if (!live && steps.length) {
      useHistory.getState().open(city, steps.length);
      goToStep(steps, steps.length);
    } else closeHistory();
  }, [city]);
  // a replay and the history do not run together
  const replaying = useReplay((s) => !!s.r);
  const historyOpen = useHistory((s) => !!s.town);
  useEffect(() => {
    if (replaying) closeHistory();
  }, [replaying]);
  const leave = () => {
    setFade(true);
    setTimeout(() => {
      useReplay.getState().stop();
      useStore.getState().setCity(null);
      setTimeout(() => setFade(false), 80);
    }, 260);
  };
  if (!g || !ov) return null;
  cityTowns.clear();
  for (const k of g.planets.keys()) cityTowns.add(k);
  (window as unknown as { __agentTownSpots?: unknown }).__agentTownSpots = (town?: string) => spotsOnScreen(g, town);
  // test hooks: planets with work in progress; planet keys, biggest first
  (window as unknown as { __galaxyLive?: string[] }).__galaxyLive = [...g.planets.values()].filter((p) => p.live).map((p) => p.key);
  (window as unknown as { __galaxyKeys?: string[] }).__galaxyKeys = [...g.planets.values()].sort((a, b) => b.town.counts.produced - a.town.counts.produced).map((p) => p.key);
  const cam = ov.center.clone().addScaledVector(VIEW_DIR, ov.dist);
  // the tour visits the planet with the most finished work
  const tourBiggest = [...g.planets.values()].sort((a, b) => b.town.counts.produced - a.town.counts.produced)[0]?.key ?? null;
  const searchList = [...g.planets.values()].map((p) => ({ key: p.key, name: p.town.name, faction: p.town.faction, badge: <Badge f={p.town.faction} /> }));
  return (
    <div className="app galaxy" onPointerMove={(e) => useStore.getState().setPointer(e.clientX, e.clientY)}>
      <Canvas flat shadows dpr={DPR} gl={{ antialias: false, powerPreference: "high-performance" }} camera={{ position: [cam.x, cam.y, cam.z], fov: 38, near: 0.05, far: 12000 }}>
        {cp && cityLayout && w ? (
          <>
            <CityScene key={cp.key} p={cp} layout={cityLayout} w={w} sys={g.systems.find((s) => s.faction === cp.town.faction)} />
            <CityProjector labels={cityLabels} />
            <TourHighlightCity />
            <RecordHost />
            <FrameGrab />
          </>
        ) : (
          <>
            <GalaxyScene g={g} />
            <TourHighlightSpace g={g} />
            <FrameGrab />
            <Projector labels={labels} g={g} />
          </>
        )}
      </Canvas>
      {cp ? <CityLabels key={cp.key} labels={cityLabels} /> : <Labels labels={labels} />}
      <Hud />
      <div className="demo-badge" data-testid="source-badge">{source === "real" ? "真实数据 · 仅本机" : source === "share" ? "Agent Universe 分享 · 只读" : emptyLogs ? t("empty.badge") : "演示数据：模拟的世界与任务，不是你的真实会话"}</div>
      <Tour biggest={tourBiggest} hasRobot={!!(tourBiggest && g.planets.get(tourBiggest)?.live)} />
      {emptyLogs ? <EmptyLogsCard where={emptyLogs} /> : null}
      {cp ? <CityBar g={g} onLeave={leave} /> : <><ShellMeter g={g} /><FocusBar g={g} /><Search towns={searchList} /></>}
      {cp ? <CityLegend /> : <Legend />}
      <ReplayBar />
      {cp ? <HistoryPanel /> : null}
      {cp ? <FollowCard faction={cp.town.faction} /> : null}
      <div className={`g-fade${fade ? " on" : ""}`} />
      {Q.get("fps") === "1" ? <FpsMeter /> : null}
      <GalaxyHoverCard g={g} />
      <Diary />
      {source === "share" || historyOpen ? null : <TimelineBar />}
      <RecordDialog />
      <NeedsYou />
      {source === "real" ? <Settings /> : null}
      <div className={`g-tools${toolsSide ? " beside-diary" : ""}`}>
        {source === "real" && !cp ? <ExportShare /> : null}
        {source !== "share" && !cp ? <PosterButton /> : null}
        <MiniWindow />
      </div>
      {source === "share" ? <ShareReplays /> : null}
      <Toast />
    </div>
  );
}
