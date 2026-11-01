// What a hovered building says, and the diary of a selected request or town (spec v3 5; owner after
// the 2026-10-29 demo: the hover card shows the details).
import { useEffect, useMemo, useState } from "react";
import { formatCount } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";
import { ROLE_NAMES } from "../../../schema/src/world.ts";
import themes from "../../../../config/themes.json" with { type: "json" };
import type { ThemesConfig } from "../../../schema/src/themes.ts";
import { fetchRequest } from "../data.ts";
import { cityPlaces } from "../city/cityData.ts";
import { cityTowns, useReplay } from "../city/cityReplay.ts";
import { useStore } from "../store.ts";
import { requestDiaries, type Diary, type DiaryStep } from "../ui/diaryModel.ts";
import { TokenRows } from "../ui/HoverCard.tsx";
import { WORK_NAMES, type Spot } from "./townLayout.ts";

const KIND_NAMES: Record<string, string> = { code: "代码", docs: "文档", slides: "幻灯", image: "图片", video: "影音", data: "数据" };
const T = themes as ThemesConfig;
const themeName = (id: string) => T.themes.find((t) => t.id === id)?.name ?? ({ [T.default.id]: T.default.name, [T.fixed.capital.id]: T.fixed.capital.name, [T.fixed.outpost.id]: T.fixed.outpost.name } as Record<string, string>)[id] ?? id;
const pad = (n: number) => String(n).padStart(2, "0");
const when = (ms: number) => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hms = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export function took(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${Math.max(m, 1)} 分钟`;
}
const outcome = (r: RequestRow, live: boolean) => (live ? "进行中" : r.ok === false ? "以失败结束" : r.ok ? "完成" : "未见结束");

function RequestLines({ r, live }: { r: RequestRow; live: boolean }) {
  return (
    <>
      {r.asked ? <div className="muted">你的原话：「{r.asked}」</div> : null}
      <div className="row"><span>{r.class === "investigation" ? "调查" : "成品"}</span><b>{r.class === "investigation" ? "只读，没有改文件" : KIND_NAMES[r.productKind ?? "code"] ?? "—"}{r.topDir ? ` · 改动最多在 ${r.topDir === "." ? "根目录" : r.topDir}` : ""}</b></div>
      <div className="row"><span>结果</span><b className={r.ok === false ? "bad" : ""}>{outcome(r, live)}</b></div>
      <div className="row"><span>开始</span><b>{when(r.startTs)} · 用时 {took(r.endTs - r.startTs)}</b></div>
      <TokenRows t={r.tokens} label="token" />
      <div className="row"><span>工具调用</span><b>{r.calls} 次{r.fails ? ` · 失败 ${r.fails}` : ""}{r.spawns ? ` · 子代理 ${r.spawns}` : ""} · {r.turns} 轮</b></div>
      <div className="row"><span>技能</span><b>{r.skills.length ? r.skills.join("、") : "没有用技能"}</b></div>
    </>
  );
}

/** the hover card for one building of the 2.5D world */
export function SpotCard({ district, spot }: { district: string; spot: Spot }) {
  const w = useStore((s) => s.w25);
  if (!w) return null;
  const town = w.towns.get(district);
  const art = w.resolved.get(spot);
  const note = art?.fallback ? <div className="muted">示意图：这个主题的画还没画好，暂用相近的建筑</div> : null;
  const head = (title: string) => <h4>{title}</h4>;
  const i = spot.info;
  if (i.kind === "house" || i.kind === "tent") {
    const r = w.requests.get(i.requestId);
    if (!r) return null;
    return (
      <div data-testid="spot-card">
        {head(r.title ?? "（无标题）")}
        <RequestLines r={r} live={w.live.has(r.requestId)} />
        <div className="muted">房子大小 = 工作量在本镇的档位 · 点击打开任务日记</div>
        {note}
      </div>
    );
  }
  if (i.kind === "public") return <div data-testid="spot-card">{head(WORK_NAMES[i.work] ?? i.work)}<div className="row"><span>这个镇里</span><b>{i.count.toLocaleString()} 次</b></div><div className="muted">代理做这类工作时来这里；做过 5 次以上才建</div>{note}</div>;
  if (i.kind === "landmark") return <div data-testid="spot-card">{head(`${town?.name ?? ""} 的地标`)}<div className="row"><span>主题</span><b>{town ? themeName(town.theme) : "—"}</b></div><div className="row"><span>大小</span><b>第 {i.tier} 档（成品满 1 / 10 / 40 件各长一档）</b></div>{note}</div>;
  if (i.kind === "hall") return <div data-testid="spot-card">{head("任务大厅")}<div className="muted">这个镇的 {town ? town.counts.produced + town.counts.investigation + town.counts.chat + town.counts.empty : 0} 个请求从这里开始</div>{note}</div>;
  if (i.kind === "notice") return <div data-testid="spot-card">{head("告示板")}<div className="row"><span>问答</span><b>{i.chats} 次</b></div><div className="muted">没有成品的请求只记数，不建房</div></div>;
  return null;
}

function Steps({ steps }: { steps: DiaryStep[] }) {
  return (
    <>
      {steps.map((s, k) => (
        <div key={k} className={`step ${s.status === "error" || s.status === "denied" ? "bad" : ""}`} data-step>
          <span className="when">{hms(s.ts)}</span>
          <span className="role">{s.role ? ROLE_NAMES[s.role] : "—"}</span>
          <span className="tool">{s.tool}{s.status === "denied" ? " · 被拒绝" : s.status === "error" ? " · 失败" : ""}</span>
          <span className="target">{s.target ?? ""}</span>
        </div>
      ))}
    </>
  );
}

/** the diary of a selected request: the request's summary, then each turn's steps */
export function RequestDiary({ district, requestId }: { district: string; requestId: string }) {
  const w = useStore((s) => s.w25);
  const liveTasks = useStore((s) => s.live);
  const r = w?.requests.get(requestId);
  const [got, setGot] = useState<{ id: string; diaries?: Diary[]; events?: AgentTownEvent[]; error?: string } | null>(null);
  const city = useStore((s) => s.city);
  useEffect(() => {
    if (!r) return;
    let alive = true;
    setGot({ id: requestId });
    fetchRequest(requestId, r.taskIds)
      .then((evs: AgentTownEvent[]) => alive && setGot({ id: requestId, diaries: requestDiaries(evs, r.taskIds, liveTasks), events: evs }))
      .catch((e: unknown) => alive && setGot({ id: requestId, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [requestId, r, liveTasks]);
  const town = w?.towns.get(district);
  const ds = got?.id === requestId ? got.diaries : undefined;
  const steps = useMemo(() => ds?.reduce((a, d) => a + d.main.length + d.agents.reduce((b, x) => b + x.steps.length, 0), 0) ?? 0, [ds]);
  if (!r) return <p className="muted">这个请求不在当前的世界里</p>;
  return (
    <>
      <small>{town ? `${town.faction === "codex" ? "Codex" : "Claude Code"} · ${town.name}` : ""}</small>
      <h3>{r.title ?? "（无标题）"}</h3>
      <RequestLines r={r} live={w!.live.has(r.requestId)} />
      {got?.id === requestId && got.events?.length && cityTowns.has(district) ? (
        <button
          className="replay-btn" data-testid="city-replay"
          onClick={() => {
            const layout = useStore.getState().w25?.layouts.get(district);
            if (!layout) return;
            useReplay.getState().start(district, requestId, r.title ?? "（无标题）", got.events!, cityPlaces(layout, requestId));
            if (useStore.getState().city !== district) useStore.getState().setCity(district);
          }}
        >▶ {city === district ? "在城里重放这次请求" : "进城重放这次请求"}</button>
      ) : null}
      {got?.error ? <p className="muted">读取记录失败：{got.error}</p> : !ds ? <p className="muted">正在读取任务记录…</p> : (
        <section>
          <h4>经过 · {ds.length} 轮 · {steps} 步</h4>
          {ds.map((d, i) => (
            <details key={d.taskId} open={i === 0} className="turn">
              <summary>第 {i + 1} 轮 · {i === 0 ? "你的请求" : d.triggerBy === "peer" ? "子代理回报后继续" : d.triggerBy === "compact" ? "上下文压缩后继续" : "系统消息后继续"} · {hms(d.start)} · {formatCount(d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite)} token</summary>
              <Steps steps={d.main} />
              {d.agents.map((a) => (
                <details key={a.agentId} className="agent">
                  <summary>子代理 · {a.agentType ?? a.agentId} · {a.steps.length} 步</summary>
                  <Steps steps={a.steps} />
                </details>
              ))}
            </details>
          ))}
        </section>
      )}
    </>
  );
}

/** a selected town: what it is and what was made there */
export function TownPanel({ district }: { district: string }) {
  const w = useStore((s) => s.w25);
  const t = w?.towns.get(district);
  if (!t) return <p className="muted">这个镇不在当前的世界里</p>;
  const l = w!.layouts.get(district)!;
  return (
    <>
      <small>{t.faction === "codex" ? "Codex" : "Claude Code"} · {themeName(t.theme)}</small>
      <h3>{t.name}</h3>
      {t.skillNote ? <div className="muted">{t.skillNote}</div> : null}
      <div className="row"><span>成品</span><b>{t.counts.produced} 件（画出 {l.streets.reduce((a, s) => a + s.drawn, 0)} 件主要的）</b></div>
      <div className="row"><span>调查</span><b>{t.counts.investigation} 次</b></div>
      <div className="row"><span>问答</span><b>{t.counts.chat + t.counts.empty} 次</b></div>
      <section>
        <h4>街道（一级目录）</h4>
        {l.streets.map((s) => <div key={s.name} className="row"><span>{s.name}</span><b>{s.drawn} 栋{s.minor ? ` · 另有 ${s.minor} 件小改动` : ""}</b></div>)}
      </section>
      <section>
        <h4>这里做过的工作</h4>
        {Object.entries(t.workCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => <div key={k} className="row"><span>{WORK_NAMES[k] ?? k}</span><b>{n.toLocaleString()} 次</b></div>)}
      </section>
    </>
  );
}
