// The task diary (spec 4): opens beside the world when a house, site or figure is selected and
// tells that task's whole story — every step, its tokens, rework, and a replay on the town's site.
import { useEffect, useMemo, useState } from "react";
import { formatCount } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import { ROLE_NAMES } from "../../../schema/src/world.ts";
import { fetchTask } from "../data.ts";
import { districtKey } from "../orchestrator/worldgen.ts";
import type { Selection } from "../selection.ts";
import { useStore } from "../store.ts";
import { diaryOf, type Diary as DiaryT, type DiaryStep } from "./diaryModel.ts";
import { TokenRows } from "./HoverCard.tsx";

/** steps rendered at once; the rest behind a "还有 N 步" button */
const FIRST_STEPS = 200;

const pad = (n: number) => String(n).padStart(2, "0");
const hms = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const dateTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms(ms)}`;
};
function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
}
const OUTCOME = { ok: "成功", error: "失败", unknown: "未见结束", running: "进行中" } as const;
const OPENED_BY = { peer: "子代理回报后继续", compact: "上下文压缩后继续", meta: "系统消息后继续", other: "系统消息后继续" } as const;
const PLACED = { files: "按改动的文件", inferred: "按命令里的路径推断", cwd: "按启动目录" } as const;

/** the task a selection is about: the house's task, the site's live task, or the agent's task */
export function taskOfSelection(sel: Selection | null, events: AgentTownEvent[], live: Set<string>): string | null {
  if (!sel) return null;
  if (sel.kind === "task") return sel.taskId;
  const inTown = (e: AgentTownEvent) => districtKey(e) === sel.district;
  let found: string | null = null;
  for (const e of events) {
    if (!e.taskId || !inTown(e)) continue;
    if (sel.kind === "site" && e.kind === "task_start" && (live.has(e.taskId) || !live.size)) found = e.taskId;
    if (sel.kind === "agent" && e.agentId === sel.agentId && live.has(e.taskId)) found = e.taskId;
  }
  return found;
}

function Step({ s }: { s: DiaryStep }) {
  return (
    <div className={`step ${s.status === "error" || s.status === "denied" ? "bad" : ""}`} data-step>
      <span className="when">{hms(s.ts)}</span>
      <span className="role">{s.role ? ROLE_NAMES[s.role] : "—"}</span>
      <span className="tool">{s.tool}{s.status === "denied" ? " · 被拒绝" : s.status === "error" ? " · 失败" : s.status === "running" ? " · 进行中" : ""}</span>
      <span className="tk">{s.tokens ? formatCount(s.tokens) : "—"}</span>
      {s.target ? <span className="target" title={s.target}>{s.target}</span> : null}
    </div>
  );
}

function Steps({ steps }: { steps: DiaryStep[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? steps : steps.slice(0, FIRST_STEPS);
  return (
    <>
      {shown.map((s, i) => <Step key={i} s={s} />)}
      {steps.length > shown.length ? <button className="more" onClick={() => setAll(true)}>还有 {steps.length - shown.length} 步</button> : null}
    </>
  );
}

export function Diary() {
  const selected = useStore((s) => s.selected);
  const events = useStore((s) => s.events);
  const live = useStore((s) => s.live);
  const replay = useStore((s) => s.replay);
  const world = useStore((s) => s.world);
  const taskId = useMemo(() => taskOfSelection(selected, events, live), [selected, events, live]);
  const [got, setGot] = useState<{ taskId: string; events?: AgentTownEvent[]; diary?: DiaryT; error?: string } | null>(null);

  useEffect(() => {
    if (!taskId) return setGot(null);
    let alive = true;
    setGot({ taskId });
    fetchTask(taskId)
      .then((evs) => alive && setGot({ taskId, events: evs, diary: diaryOf(evs, taskId, live.has(taskId)) }))
      .catch((e: unknown) => alive && setGot({ taskId, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [taskId, live]);

  if (!selected) return null;
  const town = world.districts.find((d) => d.key === selected.district);
  const d = got?.taskId === taskId ? got?.diary : undefined;
  return (
    <aside className="diary" data-testid="diary">
      <header>
        <button className="back" onClick={() => useStore.getState().back()} aria-label="返回">← 返回</button>
        <small>{town ? `${town.faction === "codex" ? "Codex" : "Claude Code"} · ${town.name}` : ""}</small>
      </header>
      {!taskId ? (
        <p className="muted">这里现在没有进行中的任务</p>
      ) : got?.error ? (
        <p className="muted">读取任务失败：{got.error}</p>
      ) : !d ? (
        <p className="muted">正在读取任务记录…</p>
      ) : (
        <>
          <h3>{d.title ?? (d.continues ? `接续：${d.continues}` : "（无标题：系统触发的任务）")}</h3>
          <div className="meta">{d.triggerBy ? `${OPENED_BY[d.triggerBy]} · ` : ""}{d.models.join("、") || "模型未知"}{d.projectBy ? ` · 归入此镇：${PLACED[d.projectBy]}` : ""}</div>
          <div className="row"><span>开始</span><b>{dateTime(d.start)}</b></div>
          <div className="row"><span>结束</span><b>{d.end !== null ? dateTime(d.end) : "—"}</b></div>
          <div className="row"><span>用时</span><b>{d.end !== null ? dur(d.end - d.start) : "—"}</b></div>
          <div className={`row outcome-${d.outcome}`}><span>结果</span><b>{OUTCOME[d.outcome]}</b></div>
          <TokenRows t={d.tokens} label="合计 token" />
          <div className="row"><span>其中子代理</span><b>{formatCount(d.subagentTokens)}</b></div>
          <div className="row"><span>等效花费</span><b>未配置价格</b></div>
          <button
            className="replay"
            disabled={!d.replayable || replay?.taskId === d.taskId}
            title={d.replayable ? "在这个镇的工地上把这个任务从地基重新盖一遍" : "这个演示任务只有摘要，没有逐步记录"}
            onClick={() => got?.events && useStore.getState().startReplay(selected.district, got.events)}
          >
            重放
          </button>
          {d.rework.length ? (
            <section>
              <h4>返工</h4>
              {d.rework.map((r) => <div key={r.file} className="row"><span className="target">{r.file}</span><b>改了 {r.edits} 次</b></div>)}
            </section>
          ) : null}
          <section>
            <h4>步骤 · 指挥官 {d.main.length} 步</h4>
            <div className="stephead"><span>时间</span><span>角色</span><span>工具</span><span>token</span></div>
            <Steps steps={d.main} />
          </section>
          {d.agents.map((a) => (
            <details key={a.agentId} className="agent">
              <summary>子代理 · {a.agentType ?? a.agentId} · {a.steps.length} 步 · {formatCount(a.tokens)}</summary>
              {a.agentTask ? <div className="task">{a.agentTask}</div> : null}
              <Steps steps={a.steps} />
            </details>
          ))}
        </>
      )}
    </aside>
  );
}
