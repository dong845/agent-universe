// Hover cards (plan "悬停查看 token"): HTML over the canvas, following the mouse, shown 150 ms after
// the pointer settles. Every number comes from the ledger as of the playback clock.
import { useEffect, useState } from "react";
import { formatCount, keys, totalOf } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent, Tokens } from "../../../schema/src/event.ts";
import { BUILDINGS, ROLE_NAMES } from "../../../schema/src/world.ts";
import { activeAt, floorsAt, sampleActor } from "../orchestrator/timeline.ts";
import { absTime, useStore, type HoverTarget } from "../store.ts";

const SHOW_AFTER_MS = 150;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function TokenRows({ t, label = "累计 token" }: { t: Tokens; label?: string }) {
  return (
    <>
      <Row k={label} v={formatCount(totalOf(t))} />
      <div className="split">
        <span className="c-input">输入 {formatCount(t.input)}</span>
        <span className="c-output">输出 {formatCount(t.output)}</span>
        <span className="c-cache">缓存读 {formatCount(t.cacheRead)}</span>
        <span>缓存写 {formatCount(t.cacheWrite)}</span>
      </div>
    </>
  );
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

/** the newest event at or before `abs` that matches */
function lastBefore(events: AgentTownEvent[], abs: number, pred: (e: AgentTownEvent) => boolean): AgentTownEvent | undefined {
  let found: AgentTownEvent | undefined;
  for (const e of events) {
    if (e.ts > abs) break;
    if (pred(e)) found = e;
  }
  return found;
}

/** sessions with a task started and not yet ended at `abs` */
function openSessions(events: AgentTownEvent[], abs: number): number {
  const open = new Map<string, string>();
  for (const e of events) {
    if (e.ts > abs) break;
    if (e.kind === "task_start" && e.taskId) open.set(e.taskId, e.sessionId);
    if (e.kind === "task_end" && e.taskId) open.delete(e.taskId);
  }
  return new Set(open.values()).size;
}

/** "更新于 N 秒前": age of the newest model call counted in this card */
function Freshness({ abs, last }: { abs: number; last?: AgentTownEvent }) {
  if (!last) return <div className="fresh">尚无消耗</div>;
  return <div className="fresh">更新于 {Math.max(0, Math.round((abs - last.ts) / 1000))} 秒前</div>;
}

export function CardBody({ target }: { target: HoverTarget }) {
  const { events, timeline, ledger } = useStore.getState();
  const t = useStore((s) => s.uiT);
  const abs = absTime(t);
  const first = events[0];
  const task = events.find((e) => e.kind === "task_start" && e.ts <= abs);
  const taskId = task?.taskId ?? null;
  const pricing = <Row k="等效花费" v="未配置价格" />;

  if (target.kind === "figure") {
    const actor = timeline.actors.find((a) => a.id === target.agentId);
    if (!actor || !first) return null;
    const s = sampleActor(actor, t);
    const key = keys.agent({ sessionId: first.sessionId, agentId: actor.id });
    const lastCall = lastBefore(events, abs, (e) => e.kind === "model_call" && e.agentId === actor.id);
    const current = s.eventId ? events.find((e) => e.id === s.eventId) : undefined;
    const tool = current?.kind === "tool_start" ? current : current?.toolUseId ? events.find((e) => e.kind === "tool_start" && e.toolUseId === current.toolUseId) : undefined;
    return (
      <>
        <h4>
          {actor.kind === "commander" ? "指挥官" : `子代理 · ${ROLE_NAMES[actor.baseRole]}`}
          <small>{actor.kind === "commander" ? "主 agent" : actor.agentType}</small>
        </h4>
        {actor.agentTask ? <div className="task">{actor.agentTask}</div> : null}
        <Row k="当前" v={tool ? `${tool.tool} · ${ROLE_NAMES[s.outfit]}` : s.pose === "think" ? "思考中" : "待命"} />
        {tool?.target ? <div className="target">{tool.target}</div> : null}
        <Row k="本步 token" v={s.pose === "think" && lastCall ? formatCount(totalOf(lastCall.tokens!)) : "—"} />
        <TokenRows t={ledger.tokensAt(key, abs)} />
        <Row k="上下文占用" v={`${Math.round(s.backpack * 100)}%`} />
        <Freshness abs={abs} last={lastCall} />
      </>
    );
  }

  if (target.kind === "site") {
    if (!taskId || !task) return null;
    const ended = timeline.roofAt !== null && t >= timeline.roofAt;
    const failing = activeAt(timeline.smoke, t);
    const roles = new Set(events.filter((e) => e.ts <= abs && e.kind === "tool_start" && e.role).map((e) => ROLE_NAMES[e.role!]));
    const lastCall = lastBefore(events, abs, (e) => e.kind === "model_call" && e.taskId === taskId);
    return (
      <>
        <h4>任务工地<small>{ended ? "已完工" : failing ? "测试失败中" : "进行中"}</small></h4>
        {task.title ? <div className="task">{task.title}</div> : null}
        <Row k="已用时" v={fmtDur((ended ? timeline.roofAt! : t) - (task.ts - timeline.t0))} />
        <Row k="楼层" v={String(floorsAt(timeline, t).length)} />
        <TokenRows t={ledger.tokensAt(keys.task(taskId), abs)} label="合计 token" />
        <Row k="其中子代理" v={formatCount(totalOf(ledger.tokensAt(keys.taskSubagents(taskId), abs)))} />
        {pricing}
        <Row k="参与角色" v={[...roles].join("、") || "—"} />
        <Freshness abs={abs} last={lastCall} />
      </>
    );
  }

  if (target.kind === "scaffold") {
    const actor = timeline.actors.find((a) => a.id === target.agentId);
    if (!actor || !first) return null;
    const steps = events.filter((e) => e.agentId === actor.id && e.ts <= abs && (e.kind === "tool_start" || e.kind === "model_call")).length;
    const lastCall = lastBefore(events, abs, (e) => e.kind === "model_call" && e.agentId === actor.id);
    return (
      <>
        <h4>子代理脚手架<small>{actor.agentType}</small></h4>
        {actor.agentTask ? <div className="task">{actor.agentTask}</div> : null}
        <Row k="步骤数" v={String(steps)} />
        <TokenRows t={ledger.tokensAt(keys.agent({ sessionId: first.sessionId, agentId: actor.id }), abs)} />
        <Row k="已用时" v={fmtDur(t - actor.appear)} />
        <Freshness abs={abs} last={lastCall} />
      </>
    );
  }

  if (target.kind === "building") {
    const b = BUILDINGS.find((x) => x.id === target.id)!;
    const st = first ? ledger.buildingAt(keys.building(first.projectId, b.id), abs) : { calls: 0, durationMs: 0, attributedInput: 0 };
    return (
      <>
        <h4>{b.name}<small>{b.what}</small></h4>
        <Row k="调用次数" v={String(st.calls)} />
        <Row k="总耗时" v={fmtDur(st.durationMs)} />
        <Row k="归因输入 token" v={formatCount(st.attributedInput)} />
        <div className="fresh">归因：工具结果之后下一次模型请求的新增输入</div>
      </>
    );
  }

  if (target.kind === "faction" || target.kind === "district") {
    if (!first) return null;
    const tk = ledger.tokensAt(keys.faction(first), abs);
    const read = tk.cacheRead;
    const hit = read + tk.input + tk.cacheWrite ? read / (read + tk.input + tk.cacheWrite) : 0;
    return (
      <>
        <h4>{first.faction === "claude-code" ? "Claude Code 阵营" : "Codex 阵营"}<small>{first.projectId}</small></h4>
        <TokenRows t={tk} />
        {pricing}
        <Row k="缓存命中率" v={`${(hit * 100).toFixed(1)}%`} />
        <Row k="活跃会话" v={String(openSessions(events, abs))} />
      </>
    );
  }
  return null;
}

export function HoverCard() {
  const hovered = useStore((s) => s.hovered);
  const pointer = useStore((s) => s.pointer);
  const [shown, setShown] = useState<HoverTarget | null>(null);
  useEffect(() => {
    if (!hovered) {
      setShown(null); // leaving hides at once
      return;
    }
    const id = setTimeout(() => setShown(hovered), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, [hovered]);
  if (!shown) return null;
  return (
    <div
      className="card"
      data-testid="hover-card"
      style={{
        // follow the mouse, flipping to the other side near the right and bottom edges
        left: pointer.x > window.innerWidth - 320 ? pointer.x - 296 : pointer.x + 16,
        top: pointer.y > window.innerHeight - 300 ? Math.max(8, pointer.y - 280) : pointer.y + 16,
      }}
    >
      <CardBody target={shown} />
    </div>
  );
}
