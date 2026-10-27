// HUD (plan "顶部 HUD 常驻") and the replay bar (plan "回放").
import { formatCount, keys, totalOf } from "../../../schema/src/aggregate.ts";
import { absTime, SPEEDS, useStore } from "../store.ts";

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Hud() {
  const t = useStore((s) => s.uiT);
  const events = useStore((s) => s.events);
  const ledger = useStore((s) => s.ledger);
  const abs = absTime(t);
  const all = ledger.tokensAt(keys.global(), abs);
  const claude = ledger.tokensAt(keys.faction({ faction: "claude-code" }), abs);
  const codex = ledger.tokensAt(keys.faction({ faction: "codex" }), abs);
  const open = new Set<string>();
  for (const e of events) {
    if (e.ts > abs) break;
    if (e.kind === "task_start" && e.taskId) open.add(e.taskId);
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
  const tl = useStore((s) => s.timeline);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const { setTime, setPlaying, setSpeed } = useStore.getState();
  const d = Math.max(1, tl.duration);
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
          {tl.markers
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
