// HUD (plan "顶部 HUD 常驻") and the replay bar (plan "回放").
import { formatCount, keys, totalOf } from "../../../schema/src/aggregate.ts";
import { absTime, SPEEDS, useStore } from "../store.ts";
import { clockLabel, replayClock } from "./format.ts";


export function Hud() {
  const t = useStore((s) => s.uiT);
  const events = useStore((s) => s.events);
  const unended = useStore((s) => s.unended);
  const ledger = useStore((s) => s.ledger);
  const abs = absTime(t);
  const all = ledger.tokensAt(keys.global(), abs);
  const claude = ledger.tokensAt(keys.faction({ faction: "claude-code" }), abs);
  const codex = ledger.tokensAt(keys.faction({ faction: "codex" }), abs);
  const open = new Set<string>();
  for (const e of events) {
    if (e.ts > abs) break;
    if (e.kind === "task_start" && e.taskId && !unended.has(e.taskId)) open.add(e.taskId);
    if (e.kind === "task_end" && e.taskId) open.delete(e.taskId);
  }
  return (
    <div className="hud" data-testid="hud">
      <div><span>全局 token</span><b data-testid="hud-total">{formatCount(totalOf(all))}</b></div>
      <div><span>等效花费</span><b>未配置价格</b></div>
      <div><span>Claude Code</span><b>{formatCount(totalOf(claude))}</b></div>
      <div><span>Codex</span><b>{formatCount(totalOf(codex))}</b></div>
      <div><span>进行中任务</span><b data-testid="hud-open">{open.size}</b></div>
    </div>
  );
}

export function TimelineBar() {
  const t = useStore((s) => s.uiT);
  const runtimes = useStore((s) => s.runtimes);
  const duration = useStore((s) => s.duration);
  const t0 = useStore((s) => s.t0);
  const source = useStore((s) => s.source);
  const replay = useStore((s) => s.replay);
  const rrt = replay ? runtimes.find((r) => r.district.key === replay.district) : undefined;
  const clock = (ms: number) => (rrt?.timeline ? replayClock(ms, { offset: rrt.offset, t0: rrt.timeline.t0 }) : clockLabel(ms, t0, source));
  const markers = runtimes.flatMap((r) => (r.timeline ? r.timeline.markers.map((m) => ({ ...m, t: m.t + r.offset })) : []));
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const { setTime, setPlaying, setSpeed } = useStore.getState();
  const d = Math.max(1, duration);
  return (
    <div className="bar">
      <button onClick={() => setPlaying(!playing)} aria-label={playing ? "暂停" : "播放"}>{playing ? "❚❚" : "▶"}</button>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="倍速">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>
      <div className="track">
        <div className="marks">
          {markers
            .filter((m) => m.kind === "task_start" || m.kind === "task_end" || m.kind === "agent_spawn" || m.kind === "agent_return" || m.status === "error" || m.status === "denied" || m.kind === "compaction" || m.kind === "awaiting_user")
            .map((m, i) => (
              <i key={i} className={`m-${m.status === "error" || m.status === "denied" ? "bad" : m.kind}`} style={{ left: `${(m.t / d) * 100}%` }} title={m.kind} />
            ))}
        </div>
        <input type="range" min={0} max={d} step={50} value={t} onChange={(e) => setTime(Number(e.target.value))} aria-label="时间轴" />
      </div>
      <span className="time" data-testid="clock">{clock(t)} / {clock(d)}</span>
      <button disabled title="实时模式在第 4 阶段接入">实时</button>
    </div>
  );
}

/** world navigation: back to the whole map, or fly to the next town with a live task */
export function Nav() {
  const focus = useStore((s) => s.focus);
  const runtimes = useStore((s) => s.runtimes);
  const live = runtimes.filter((r) => r.timeline).map((r) => r.district);
  const current = runtimes.find((r) => r.district.key === focus)?.district;
  const next = () => {
    const i = live.findIndex((d) => d.key === focus);
    useStore.getState().setFocus(live[(i + 1) % live.length]?.key ?? null);
  };
  return (
    <div className="nav">
      <button onClick={() => useStore.getState().setFocus(null)} className={focus ? "" : "on"} data-testid="nav-world">全景</button>
      <button onClick={next} disabled={!live.length} data-testid="nav-live">当前活跃工地{live.length ? ` (${live.length})` : ""}</button>
      {current ? <span className="where">{current.faction === "codex" ? "Codex" : "Claude Code"} · {current.name}</span> : <span className="where">世界 · {useStore.getState().world.districts.length} 个街区</span>}
    </div>
  );
}
