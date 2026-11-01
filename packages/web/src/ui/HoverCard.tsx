// Hover cards (plan "悬停查看 token"): HTML over the canvas, following the mouse, shown 150 ms after
// the pointer settles. Every number comes from the ledger as of the playback clock.
import { SpotCard } from "../v3/Cards25.tsx";
import { useEffect, useState } from "react";
import { formatCount, keys, totalOf } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent, Tokens } from "../../../schema/src/event.ts";
import { BUILDINGS, ROLE_NAMES } from "../../../schema/src/world.ts";
import { activeAt, floorsAt, sampleActor } from "../orchestrator/timeline.ts";
import { TIER_NAMES, TIER_TOKENS } from "../orchestrator/worldgen.ts";
import { absTime, runtimeOf, useStore, type HoverTarget } from "../store.ts";
import { openSessions } from "./counts.ts";

const SHOW_AFTER_MS = 150;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

export function TokenRows({ t, label = "累计 token" }: { t: Tokens; label?: string }) {
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
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
  return `${Math.floor(s / 86400)} 天`;
}

function lastBefore(events: AgentTownEvent[], abs: number, pred: (e: AgentTownEvent) => boolean): AgentTownEvent | undefined {
  let found: AgentTownEvent | undefined;
  for (const e of events) {
    if (e.ts > abs) break;
    if (pred(e)) found = e;
  }
  return found;
}

/** "更新于 N 秒前": age of the newest model call counted in this card */
function Freshness({ abs, last }: { abs: number; last?: AgentTownEvent }) {
  if (!last) return <div className="fresh">尚无消耗</div>;
  return <div className="fresh">更新于 {fmtDur(abs - last.ts)}前</div>;
}

export function CardBody({ target }: { target: HoverTarget }) {
  const { events, ledger, world } = useStore.getState();
  const t = useStore((s) => s.uiT);
  useStore((s) => s.historyAt);
  const abs = absTime(t);
  const pricing = <Row k="等效花费" v="未配置价格" />;

  if (target.kind === "faction") {
    const tk = ledger.tokensAt(keys.faction({ faction: target.faction }), abs);
    const hit = tk.cacheRead + tk.input + tk.cacheWrite ? tk.cacheRead / (tk.cacheRead + tk.input + tk.cacheWrite) : 0;
    const towns = world.districts.filter((d) => d.faction === target.faction);
    return (
      <>
        <h4>{target.faction === "codex" ? "Codex 阵营" : "Claude Code 阵营"}<small>{towns.length} 个街区</small></h4>
        <TokenRows t={tk} />
        {pricing}
        <Row k="缓存命中率" v={`${(hit * 100).toFixed(1)}%`} />
        <Row k="活跃会话" v={String(openSessions(events, abs, (e) => e.faction === target.faction, useStore.getState().unended))} />
      </>
    );
  }

  const rt = runtimeOf(target.district);
  if (!rt) return null;
  const d = rt.district;
  const tl = rt.timeline;
  const lt = t - rt.offset;
  const inTown = (e: AgentTownEvent) => e.faction === d.faction && e.projectId === d.projectId;

  if (target.kind === "district") {
    const tk = ledger.tokensAt(keys.district(d), abs);
    const next = TIER_TOKENS[d.tier];
    const biggest = [...d.houses].sort((a, b) => b.tokens - a.tokens)[0];
    return (
      <>
        <h4>{d.name}<small>{TIER_NAMES[d.tier - 1]} · {d.faction === "codex" ? "Codex" : "Claude Code"}</small></h4>
        <div className="target">{d.projectId}</div>
        <TokenRows t={tk} />
        <Row k="完成的任务" v={`${d.houses.length + d.olderTasks} 个`} />
        {biggest ? <Row k="最贵的任务" v={`${biggest.title ?? "—"} · ${formatCount(biggest.tokens)}`} /> : null}
        <Row k="下一级" v={next !== undefined ? `累计 ${formatCount(next)}` : "已是最高级"} />
        <div className="fresh">双击飞入街区</div>
      </>
    );
  }

  if (target.kind === "house") {
    const h = d.houses.find((x) => x.taskId === target.taskId);
    if (!h) return null;
    return (
      <>
        <h4>{h.ok === null ? "停下的任务" : "已完成的任务"}<small>{h.ok === null ? "未见结束" : h.ok ? "成功" : "以失败告终"}</small></h4>
        {h.title ? <div className="task">{h.title}</div> : null}
        <TokenRows t={ledger.tokensAt(keys.task(h.taskId), abs)} label="合计 token" />
        <Row k="楼高" v={`${h.floors} 层（按 token 规模）`} />
        <Row k="完工于" v={`${fmtDur(abs - h.builtAt)}前`} />
      </>
    );
  }

  if (target.kind === "building") {
    const b = BUILDINGS.find((x) => x.id === target.id)!;
    const st = ledger.buildingAt(keys.building(d, b.id), abs);
    return (
      <>
        <h4>{b.name}<small>{d.name} · {b.what}</small></h4>
        <Row k="调用次数" v={String(st.calls)} />
        <Row k="总耗时" v={fmtDur(st.durationMs)} />
        <Row k="归因输入 token" v={formatCount(st.attributedInput)} />
        <div className="fresh">归因：工具结果之后下一次模型请求的新增输入</div>
      </>
    );
  }

  if (!tl) return null;
  const task = lastBefore(events, abs, (e) => e.kind === "task_start" && inTown(e) && !!e.taskId && tl.markers.length > 0 && e.ts >= tl.t0);
  const taskId = task?.taskId ?? null;

  if (target.kind === "figure") {
    const actor = tl.actors.find((a) => a.id === target.agentId);
    if (!actor) return null;
    const s = sampleActor(actor, lt);
    const key = keys.agent({ sessionId: events.find((e) => e.agentId === actor.id && inTown(e))?.sessionId ?? "", agentId: actor.id });
    const lastCall = lastBefore(events, abs, (e) => e.kind === "model_call" && e.agentId === actor.id && inTown(e));
    const current = s.eventId ? events.find((e) => e.id === s.eventId) : undefined;
    const tool = current?.kind === "tool_start" ? current : current?.toolUseId ? events.find((e) => e.kind === "tool_start" && e.toolUseId === current.toolUseId) : undefined;
    return (
      <>
        <h4>
          {actor.kind === "commander" ? "指挥官" : actor.agentType === "guardian" ? "哨兵 · 审批" : `子代理 · ${ROLE_NAMES[actor.baseRole]}`}
          <small>{d.name}</small>
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
    const ended = tl.roofAt !== null && lt >= tl.roofAt;
    const failing = activeAt(tl.smoke, lt);
    const roles = new Set(events.filter((e) => e.ts <= abs && e.taskId === taskId && e.kind === "tool_start" && e.role).map((e) => ROLE_NAMES[e.role!]));
    const lastCall = lastBefore(events, abs, (e) => e.kind === "model_call" && e.taskId === taskId);
    return (
      <>
        <h4>任务工地<small>{ended ? "已完工" : failing ? "测试失败中" : "进行中"}</small></h4>
        {task.title ? <div className="task">{task.title}</div> : null}
        <Row k="已用时" v={fmtDur((ended ? tl.roofAt! : lt) - (task.ts - tl.t0))} />
        <Row k="楼层" v={String(floorsAt(tl, lt).length)} />
        <TokenRows t={ledger.tokensAt(keys.task(taskId), abs)} label="合计 token" />
        <Row k="其中子代理" v={formatCount(totalOf(ledger.tokensAt(keys.taskSubagents(taskId), abs)))} />
        {pricing}
        <Row k="参与角色" v={[...roles].join("、") || "—"} />
        <Freshness abs={abs} last={lastCall} />
      </>
    );
  }

  if (target.kind === "scaffold") {
    const actor = tl.actors.find((a) => a.id === target.agentId);
    if (!actor) return null;
    const steps = events.filter((e) => e.agentId === actor.id && inTown(e) && e.ts <= abs && (e.kind === "tool_start" || e.kind === "model_call")).length;
    const lastCall = lastBefore(events, abs, (e) => e.kind === "model_call" && e.agentId === actor.id && inTown(e));
    const sid = events.find((e) => e.agentId === actor.id && inTown(e))?.sessionId ?? "";
    return (
      <>
        <h4>子代理脚手架<small>{actor.agentType}</small></h4>
        {actor.agentTask ? <div className="task">{actor.agentTask}</div> : null}
        <Row k="步骤数" v={String(steps)} />
        <TokenRows t={ledger.tokensAt(keys.agent({ sessionId: sid, agentId: actor.id }), abs)} />
        <Row k="已用时" v={fmtDur(lt - actor.appear)} />
        <Freshness abs={abs} last={lastCall} />
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
      {shown.kind === "spot" ? <SpotCard district={shown.district} spot={shown.spot} /> : <CardBody target={shown} />}
    </div>
  );
}
