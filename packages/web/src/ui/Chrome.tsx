// HUD (plan "顶部 HUD 常驻") and the replay bar (plan "回放").
import { formatCount, keys, totalOf } from "../../../schema/src/aggregate.ts";
import { absTime, SPEEDS, useStore } from "../store.ts";
import { openTasks } from "./counts.ts";
import { clockLabel, replayClock } from "./format.ts";


export function Hud() {
  const t = useStore((s) => s.uiT);
  // a history step pins the moment (absTime reads it): follow it too
  useStore((s) => s.historyAt);
  const events = useStore((s) => s.events);
  const unended = useStore((s) => s.unended);
  const ledger = useStore((s) => s.ledger);
  const source = useStore((s) => s.source);
  const w = useStore((s) => s.w25);
  const abs = absTime(t);
  // a shared world carries no events: its totals are its requests' own
  const fromRequests = (f?: string) => [...(w?.requests.values() ?? [])].filter((r) => !f || r.faction === f).reduce((a, r) => a + totalOf(r.tokens), 0);
  const shared = source === "share";
  const all = shared ? fromRequests() : totalOf(ledger.tokensAt(keys.global(), abs));
  const claude = shared ? fromRequests("claude-code") : totalOf(ledger.tokensAt(keys.faction({ faction: "claude-code" }), abs));
  const codex = shared ? fromRequests("codex") : totalOf(ledger.tokensAt(keys.faction({ faction: "codex" }), abs));
  const openCount = shared ? 0 : openTasks(events, abs, unended);
  return (
    <div className="hud" data-testid="hud">
      <div><span>全局 token</span><b data-testid="hud-total">{formatCount(all)}</b></div>
      <div><span>等效花费</span><b>未配置价格</b></div>
      <div><span>Claude Code</span><b>{formatCount(claude)}</b></div>
      <div><span>Codex</span><b>{formatCount(codex)}</b></div>
      <div><span>进行中任务</span><b data-testid="hud-open">{openCount}</b></div>
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
      <LiveButton />
    </div>
  );
}

/** world navigation: back to the whole map, or fly to the next town with a request in progress */
export function Nav() {
  const focus = useStore((s) => s.focus);
  const w = useStore((s) => s.w25);
  const liveIds = useStore((s) => s.live);
  const live = w ? [...w.towns.values()].filter((t) => [...w.requests.values()].some((r) => `${r.faction}|${r.projectId}` === t.key && r.taskIds.some((id) => liveIds.has(id)))) : [];
  const current = focus ? w?.towns.get(focus) : undefined;
  const next = () => {
    const i = live.findIndex((t) => t.key === focus);
    useStore.getState().setFocus(live[(i + 1) % live.length]?.key ?? null);
  };
  return (
    <div className="nav">
      <button onClick={() => useStore.getState().setFocus(null)} className={focus ? "" : "on"} data-testid="nav-world">全景</button>
      <button onClick={next} disabled={!live.length} data-testid="nav-live">进行中{live.length ? ` (${live.length})` : ""}</button>
      {current ? <span className="where">{current.faction === "codex" ? "Codex" : "Claude Code"} · {current.name}</span> : <span className="where">世界 · {w?.towns.size ?? 0} 个镇</span>}
    </div>
  );
}

/** 实时: the clock follows the newest record (spec 2026-11-03 A3); scrubbing or pausing leaves it */
function LiveButton() {
  const source = useStore((s) => s.source);
  const following = useStore((s) => s.following);
  if (source !== "real") return <button disabled title="只有真实数据有实时">实时</button>;
  return (
    <button className={following ? "live-on" : ""} data-testid="live" aria-pressed={following}
      title={following ? "正在跟随最新记录：拖动时间轴或暂停即离开" : "回到实时：跟随最新记录"}
      onClick={() => useStore.getState().setFollowing(true)}>{following ? "● 实时" : "实时"}</button>
  );
}
