// The history panel (owner 2026-11-01): a town's requests as steps. Choosing one stops the city at the
// moment that request finished — only the buildings that stood then — and explains the step from what
// the logs record. Not a playback: the city stands still at each step.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import { fetchRequest } from "../data.ts";
import type { Planet } from "../galaxy/galaxyData.ts";
import { useStore } from "../store.ts";
import { historySteps, stepFacts, useHistory, type HistoryStep } from "./history.ts";

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
  const [events, setEvents] = useState<{ id: string; ev: AgentTownEvent[] | null }>({ id: "", ev: null });
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!cur || shared) return;
    let alive = true;
    setEvents({ id: cur.request.requestId, ev: null });
    fetchRequest(cur.request.requestId, cur.request.taskIds)
      .then((ev) => alive && setEvents({ id: cur.request.requestId, ev }))
      .catch(() => alive && setEvents({ id: cur.request.requestId, ev: null }));
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
        {steps.map((s) => (
          <li key={s.request.requestId} className={`${s.index === step ? "on" : ""} c-${s.request.class}`}>
            <button onClick={() => goToStep(steps, s.index)} data-testid="history-step">
              <span className="n">{s.index}</span>
              <span className="d">{new Date(s.request.endTs).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</span>
              <span className="t">{s.request.title ?? "（无标题）"}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="g-history-nav">
        <button onClick={() => goToStep(steps, cur.index - 1)} disabled={cur.index <= 1} data-testid="history-prev">◀ 上一步</button>
        <span>第 {cur.index} / {steps.length} 步</span>
        <button onClick={() => goToStep(steps, cur.index + 1)} disabled={cur.index >= steps.length} data-testid="history-next">下一步 ▶</button>
      </div>
      <section className="g-history-facts" data-testid="history-facts">
        <h4>{facts.title}</h4>
        {facts.rows.map(([k, v]) => <div key={k} className="row"><span>{k}</span><b>{v}</b></div>)}
        {!cur.drawn ? <p className="muted">{r.class === "chat" ? "问答不建楼：记在城里的问答牌上。" : "城里没有单独画出这一步的楼（一座城最多画 20 栋房子、6 顶帐篷，挑的是最大的）。"}</p> : null}
        {facts.work.length ? (<><h5>做了什么</h5><div className="chips">{facts.work.map((x) => <span key={x.name}>{x.name} <b>{x.n}</b></span>)}</div></>) : null}
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
  const block = rid ? p.blocks.find((b) => (b.spot.info.kind === "house" || b.spot.info.kind === "tent") && b.spot.info.requestId === rid) : undefined;
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
  return <mesh ref={ring} geometry={RING} material={RING_MAT} position={[block.spot.x, 0.06, block.spot.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} />;
}
