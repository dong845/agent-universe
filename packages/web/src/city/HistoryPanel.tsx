// The history panel (owner 2026-11-01): a town's requests as steps. Choosing one stops the city at the
// moment that request finished — only the buildings that stood then — and explains the step from what
// the logs record. Not a playback: the city stands still at each step.
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import { fetchRequest } from "../data.ts";
import { PRODUCT_COLOR, type Block, type Planet } from "../galaxy/galaxyData.ts";
import { KitBuildings } from "./CityKit.tsx";
import { useStore } from "../store.ts";
import { historySteps, stepAgents, stepDay, stepFacts, useHistory, type HistoryStep } from "./history.ts";
import character from "../../../../art/character.json" with { type: "json" };
import { Robot, SCALE } from "./Robot.tsx";
import type { Actor } from "../orchestrator/timeline.ts";

/** at most this many subagents stand in the city for one step (the rest are listed) */
const MAX_SUBS = 12;

/** the steps of the open history (empty when closed) */
export function useSteps(): HistoryStep[] {
  const town = useHistory((s) => s.town);
  const w = useStore((s) => s.w25);
  return useMemo(() => (town && w ? historySteps(w, town) : []), [town, w]);
}

/** opening a step: the world clock stops at the moment its request finished */
export function goToStep(steps: HistoryStep[], n: number) {
  const s = steps[Math.max(0, Math.min(steps.length - 1, n - 1))];
  if (!s) return;
  useHistory.getState().go(s.index);
  const st = useStore.getState();
  st.setPlaying(false);
  st.setHistoryAt(s.request.endTs);
}

/** closing: back to now */
export function closeHistory() {
  if (!useHistory.getState().town) return;
  useHistory.getState().close();
  useStore.getState().setHistoryAt(null);
}

export function HistoryPanel() {
  const town = useHistory((s) => s.town);
  const step = useHistory((s) => s.step);
  const steps = useSteps();
  const shared = useStore((s) => s.source === "share");
  const cur = step ? steps[step - 1] : undefined;
  const loaded = useHistory((s) => s.events);
  const events = { id: loaded?.requestId ?? "", ev: loaded?.ev ?? null };
  const agents = useMemo(() => stepAgents(events.ev), [events.ev]);
  const list = useRef<HTMLOListElement>(null);
  // the rows change only with the steps' content and the chosen one: a newer world with the same steps
  // (new objects, same values) does not rebuild them
  const stepsSig = steps.map((s) => `${s.request.requestId}:${s.request.endTs}:${s.request.title ?? ""}`).join("|");
  const rows = useMemo(() => steps.map((s) => (
    <li key={s.request.requestId} className={`${s.index === step ? "on" : ""} c-${s.request.class}`}>
      <button onClick={() => goToStep(steps, s.index)} data-testid="history-step">
        <span className="n">{s.index}</span>
        <span className="d">{stepDay(s.request.endTs)}</span>
        <span className={`t${s.request.title ? "" : " gist"}`}>{s.request.title ?? s.request.gist ?? "（无标题）"}</span>
      </button>
    </li>
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the steps' content (stepsSig), not their identity
  )), [stepsSig, step]);
  useEffect(() => {
    if (!cur || shared) return;
    let alive = true;
    const id = cur.request.requestId;
    useHistory.getState().setEvents(id, null);
    fetchRequest(id, cur.request.taskIds)
      .then((ev) => alive && useHistory.getState().setEvents(id, ev))
      .catch(() => alive && useHistory.getState().setEvents(id, null));
    return () => { alive = false; };
  }, [cur, shared]);
  // ← → walk the steps
  useEffect(() => {
    if (!town) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      const s = useHistory.getState().step ?? steps.length;
      if (e.key === "ArrowLeft") goToStep(steps, s - 1);
      else if (e.key === "ArrowRight") goToStep(steps, s + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [town, steps]);
  useEffect(() => {
    list.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [step]);
  if (!town || !cur) return null;
  const facts = stepFacts(cur.request, events.id === cur.request.requestId ? events.ev : null);
  const r = cur.request;
  return (
    <aside className="g-history" data-testid="history">
      <header>
        <b>历史 · {steps.length} 步</b>
        <button onClick={closeHistory} title="回到现在" data-testid="history-close">回到现在 ✕</button>
      </header>
      <p className="muted">每一步是这个项目的一次请求，按完成先后排。选中一步，城市停在它完成的那一刻：只显示那时已经建成的楼。说明全部来自日志记录。</p>
      <ol ref={list} className="g-history-list">
        {rows}
      </ol>
      <div className="g-history-nav">
        <button onClick={() => goToStep(steps, cur.index - 1)} disabled={cur.index <= 1} data-testid="history-prev">◀ 上一步</button>
        <span>第 {cur.index} / {steps.length} 步</span>
        <button onClick={() => goToStep(steps, cur.index + 1)} disabled={cur.index >= steps.length} data-testid="history-next">下一步 ▶</button>
      </div>
      <section className="g-history-facts" data-testid="history-facts">
        <h4 className={facts.gist ? "gist" : ""} title={facts.gist ? "这个请求没有标题：这句话是从它自己的记录里拼出来的" : undefined}>{facts.title}</h4>
        {facts.rows.map(([k, v]) => <div key={k} className="row"><span>{k}</span><b>{v}</b></div>)}
        {!cur.drawn ? <p className="muted">{r.class === "chat" ? "问答不建楼：记在城里的问答牌上。" : r.class === "produced" ? "城里平时不画这一步的房子（一座城最多画 20 栋，挑最大的）：现在临时画在它那条街旁，带光圈的就是。" : "城里没有单独画出这一步（调查最多画 6 顶帐篷，挑最大的）。"}</p> : null}
        {facts.work.length ? (<><h5>做了什么</h5><div className="chips">{facts.work.map((x) => <span key={x.name}>{x.name} <b>{x.n}</b></span>)}</div></>) : null}
        {agents.length ? (
          <>
            <h5>代理（站在任务大厅旁）</h5>
            <ul className="agents" data-testid="history-agents">
              {agents.slice(0, 1 + MAX_SUBS).map((a) => (
                <li key={a.id}>
                  <b>{a.kind === "main" ? "主代理" : `子代理${a.agentType ? ` · ${a.agentType}` : ""}`}</b>
                  {a.task ? <span className="task">{a.task}</span> : null}
                  <span className="muted">{a.calls ? a.work.slice(0, 3).map((w) => `${w.name} ${w.n}`).join(" · ") : "没有调用工具"}</span>
                </li>
              ))}
            </ul>
            {agents.length > 1 + MAX_SUBS ? <p className="muted">另有 {agents.length - 1 - MAX_SUBS} 个子代理没有画出</p> : null}
          </>
        ) : null}
        {facts.files.length ? (<><h5>改了哪些文件</h5><ul className="files">{facts.files.slice(0, 8).map((f) => <li key={f.path}><code>{f.path}</code>{f.edits > 1 ? <b>×{f.edits}</b> : null}</li>)}</ul>{facts.files.length > 8 ? <p className="muted">另有 {facts.files.length - 8} 个文件</p> : null}</>) : null}
        {!shared && events.id === r.requestId && events.ev === null ? <p className="muted">正在读这一步的记录…</p> : null}
      </section>
    </aside>
  );
}

const RING = new THREE.RingGeometry(1, 1.12, 64);
const RING_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd27a").multiplyScalar(2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });

/** inside the city: a ring around the step's building, and the camera turns to it once per step */
export function HistoryFocus({ p }: { p: Planet }) {
  const step = useHistory((s) => (s.town === p.key ? s.step : null));
  const steps = useSteps();
  const rid = step ? steps[step - 1]?.request.requestId : undefined;
  const drawn = rid ? p.blocks.find((b) => (b.spot.info.kind === "house" || b.spot.info.kind === "tent") && b.spot.info.requestId === rid) : undefined;
  const req = step ? steps[step - 1]?.request : undefined;
  const layout = useStore((s) => s.w25?.layouts.get(p.key));
  // the step's own house when the city does not draw it (20-house cap): by its street, for this step only
  const ghost = useMemo<Block | undefined>(() => {
    if (drawn || !req || req.class !== "produced" || !layout) return undefined;
    const house = p.blocks.find((b) => b.type === "house");
    const street = layout.streets.find((s) => s.name === (req.topDir === null ? "其他" : req.topDir === "." ? "根目录" : req.topDir)) ?? layout.streets.find((s) => s.name === "其他") ?? layout.streets[0];
    const hall = p.blocks.find((b) => b.type === "hall");
    const at = street ? { x: street.x * 0.82, z: street.z * 0.82 } : hall ? { x: hall.spot.x + 2, z: hall.spot.z + 2 } : { x: 2, z: 2 };
    return { spot: { ...(house?.spot ?? {}), x: at.x, z: at.z, size: 1.2, info: { kind: "house", requestId: req.requestId } } as Block["spot"], type: "house", dir: house?.dir ?? [0, 1, 0], foot: house?.foot ?? p.unit, height: house?.height ?? p.unit, turn: 0, color: PRODUCT_COLOR[req.productKind ?? "code"] ?? PRODUCT_COLOR.code, live: false };
  }, [drawn, req, layout, p]);
  const block = drawn ?? ghost;
  const ring = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const glide = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    glide.current = block ? new THREE.Vector3(block.spot.x, 0, block.spot.z) : null;
  }, [block]);
  useFrame(({ clock }, dt) => {
    if (ring.current) {
      const k = (clock.elapsedTime * 0.7) % 1;
      ring.current.scale.setScalar(((block?.foot ?? 1) / p.unit) * (0.9 + k * 0.6));
      RING_MAT.opacity = 0.9 * (1 - k);
    }
    const g = glide.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 3);
    const delta = g.clone().sub(controls.target).multiplyScalar(k);
    controls.target.add(delta);
    camera.position.add(delta);
    if (delta.length() < 0.002) glide.current = null;
  });
  if (!block) return null;
  return (
    <>
      {ghost ? <Suspense fallback={null}><KitBuildings p={p} vis={[ghost]} /></Suspense> : null}
      <mesh ref={ring} geometry={RING} material={RING_MAT} position={[block.spot.x, 0.06, block.spot.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} />
    </>
  );
}

/**
 * Inside the city: the chosen step's agents standing by the task hall — the main agent in front, the
 * subagents on an arc beside it — each with who it was over its head. Still figures, not a replay.
 */
export function StandingAgents({ p }: { p: Planet }) {
  const on = useHistory((s) => s.town === p.key && s.step !== null);
  const loaded = useHistory((s) => s.events);
  const agents = useMemo(() => (on ? stepAgents(loaded?.ev ?? null) : []), [on, loaded]);
  const hall = p.blocks.find((b) => b.type === "hall");
  const actors = useMemo(() => {
    if (!hall || !agents.length) return [];
    const hx = hall.spot.x, hz = hall.spot.z;
    // on the side of the hall that faces the city's default camera (CityCamera: from +z, a little +x), so
    // the hall never hides them: the main agent in the middle, subagents beside it a figure's width
    // apart (SCALE × the head's width, plus a gap), three each side; more stand in a second row in front
    const out = Math.atan2(1.55, 0.2);
    const r0 = (hall.foot / p.unit) * 0.95 + 1.8;
    const gap = SCALE.sub * character.head.w + 0.45;
    return agents.slice(0, 1 + MAX_SUBS).map((a, i): { a: typeof a; actor: Actor } => {
      const row = i <= 6 ? 0 : 1;
      const j = row === 0 ? i : i - 7;
      // row 0: 0 = main, then right, left, right…; row 1: half a step off, so they stand in the gaps
      // (in subagent widths from the middle: half the main agent, half a subagent, then one per step)
      const side = j % 2 ? 1 : -1;
      const slot = row === 0 ? (j === 0 ? 0 : side * (SCALE.main / SCALE.sub / 2 + 0.5 + Math.ceil(j / 2) - 1)) : side * (Math.floor(j / 2) + 0.5);
      const r = r0 + row * 1.5;
      const ang = out + (slot * gap) / r;
      const role = a.kind === "main" ? "commander" : a.role && a.role !== "commander" ? a.role : (a.top ?? "commander");
      return { a, actor: { id: `hist|${a.id}|${i}`, kind: a.kind === "main" ? "commander" : "subagent", baseRole: role, agentType: a.agentType, home: { x: hx + Math.cos(ang) * r, z: hz + Math.sin(ang) * r }, lane: 0, appear: 0, vanish: null, actions: [], backpack: [] } };
    });
  }, [agents, hall, p.unit]);
  if (!actors.length) return null;
  const time = () => 1;
  return (
    <>
      {actors.map(({ a, actor }) => (
        <Robot key={actor.id} id={actor.id} actor={actor} time={time} faction={p.town.faction} end={Infinity}
          label={a.kind === "main" ? `主代理 · ${a.calls} 次调用` : `子代理${a.agentType ? ` · ${a.agentType}` : ""} · ${a.calls} 次`} />
      ))}
    </>
  );
}
