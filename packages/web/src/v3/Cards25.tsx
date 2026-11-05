// What a hovered building says, and the diary of a selected request or town (spec v3 5; owner after
// the 2026-10-29 demo: the hover card shows the details).
import { useEffect, useMemo, useState } from "react";
import { formatCount } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import type { RequestRow } from "../../../schema/src/payload.ts";
import { roleName } from "../i18n/data.ts";
import { fetchRequest } from "../data.ts";
import { cityPlaces } from "../city/cityData.ts";
import { cityTowns, useReplay } from "../city/cityReplay.ts";
import { useStore } from "../store.ts";
import { requestDiaries, type Diary, type DiaryStep } from "../ui/diaryModel.ts";
import { TokenRows } from "../ui/HoverCard.tsx";
import { copyResume } from "../ui/NeedsYou.tsx";
import { WORK_NAMES, type Spot } from "./townLayout.ts";
import { t as tx } from "../i18n/index.ts";
import { themeName } from "../i18n/data.ts";

const KIND_NAMES: Record<string, string> = { code: tx("product.code"), docs: tx("product.docs"), slides: tx("product.slides"), image: tx("product.image"), video: tx("product.video"), data: tx("product.data") };

const pad = (n: number) => String(n).padStart(2, "0");
const when = (ms: number) => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hms = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export function took(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? tx("dur.hm", { h: Math.floor(m / 60), m: m % 60 }) : tx("dur.m", { n: Math.max(m, 1) });
}
const outcome = (r: RequestRow, live: boolean) => (live ? tx("outcome.running") : r.ok === false ? tx("cards.outcomeFailed") : r.ok ? tx("robot.done") : tx("outcome.unknown"));

function RequestLines({ r, live }: { r: RequestRow; live: boolean }) {
  return (
    <>
      {r.asked ? <div className="muted">{tx("cards.asked", { text: r.asked })}</div> : null}
      <div className="row"><span>{r.class === "investigation" ? tx("cards.investigation") : tx("cards.produced")}</span><b>{r.class === "investigation" ? tx("cards.readOnly") : KIND_NAMES[r.productKind ?? "code"] ?? "—"}{r.topDir ? tx("cards.topDir", { dir: r.topDir === "." ? tx("street.root") : r.topDir }) : ""}</b></div>
      <div className="row"><span>{tx("facts.result")}</span><b className={r.ok === false ? "bad" : ""}>{outcome(r, live)}</b></div>
      <div className="row"><span>{tx("diary.start")}</span><b>{tx("cards.startTook", { when: when(r.startTs), took: took(r.endTs - r.startTs) })}</b></div>
      <TokenRows t={r.tokens} label="token" />
      <div className="row"><span>{tx("facts.calls")}</span><b>{tx("cards.callsLine", { n: r.calls })}{r.fails ? tx("cards.failsN", { n: r.fails }) : ""}{r.spawns ? tx("cards.subsN", { n: r.spawns }) : ""}{tx("cards.turnsN", { n: r.turns })}</b></div>
      <div className="row"><span>{tx("facts.skills")}</span><b>{r.skills.length ? r.skills.join(tx("gist.sep")) : tx("cards.noSkills")}</b></div>
    </>
  );
}

/** the hover card for one building of the 2.5D world */
export function SpotCard({ district, spot }: { district: string; spot: Spot }) {
  const w = useStore((s) => s.w25);
  if (!w) return null;
  const town = w.towns.get(district);
  const art = w.resolved.get(spot);
  const note = art?.fallback ? <div className="muted">{tx("cards.artFallback")}</div> : null;
  const head = (title: string) => <h4>{title}</h4>;
  const i = spot.info;
  if (i.kind === "house" || i.kind === "tent") {
    const r = w.requests.get(i.requestId);
    if (!r) return null;
    return (
      <div data-testid="spot-card">
        {head(r.title ?? tx("history.untitled"))}
        <RequestLines r={r} live={w.live.has(r.requestId)} />
        <div className="muted">{tx("cards.houseHint")}</div>
        {note}
      </div>
    );
  }
  if (i.kind === "public") return <div data-testid="spot-card">{head(WORK_NAMES[i.work] ?? i.work)}<div className="row"><span>{tx("cards.inTown")}</span><b>{tx("card.timesN", { n: i.count.toLocaleString() })}</b></div><div className="muted">{tx("cards.publicHint")}</div>{note}</div>;
  if (i.kind === "landmark") return <div data-testid="spot-card">{head(tx("cards.landmark", { name: town?.name ?? "" }))}<div className="row"><span>{tx("card.theme")}</span><b>{town ? themeName(town.theme) : "—"}</b></div><div className="row"><span>{tx("cards.size")}</span><b>{tx("cards.tier", { n: i.tier })}</b></div>{note}</div>;
  if (i.kind === "hall") return <div data-testid="spot-card">{head(tx("city.hall"))}<div className="muted">{tx("cards.hallHint", { n: town ? town.counts.produced + town.counts.investigation + town.counts.chat + town.counts.empty : 0 })}</div>{note}</div>;
  if (i.kind === "notice") return <div data-testid="spot-card">{head(tx("cards.notice"))}<div className="row"><span>{tx("card.chat")}</span><b>{tx("card.timesN", { n: i.chats })}</b></div><div className="muted">{tx("cards.noticeHint")}</div></div>;
  return null;
}

function Steps({ steps }: { steps: DiaryStep[] }) {
  return (
    <>
      {steps.map((s, k) => (
        <div key={k} className={`step ${s.status === "error" || s.status === "denied" ? "bad" : ""}`} data-step>
          <span className="when">{hms(s.ts)}</span>
          <span className="role">{s.role ? roleName(s.role) : "—"}</span>
          <span className="tool">{s.tool}{s.status === "denied" ? tx("step.denied") : s.status === "error" ? tx("step.error") : ""}</span>
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
  const source = useStore((s) => s.source);
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
  if (!r) return <p className="muted">{tx("cards.notInWorld")}</p>;
  return (
    <>
      <small>{town ? `${town.faction === "codex" ? "Codex" : "Claude Code"} · ${town.name}` : ""}</small>
      <h3>{r.title ?? tx("history.untitled")}</h3>
      <RequestLines r={r} live={w!.live.has(r.requestId)} />
      {got?.id === requestId && got.events?.length && cityTowns.has(district) ? (
        <button
          className="replay-btn" data-testid="city-replay"
          onClick={() => {
            const layout = useStore.getState().w25?.layouts.get(district);
            if (!layout) return;
            useReplay.getState().start(district, requestId, r.title ?? tx("history.untitled"), got.events!, cityPlaces(layout, requestId));
            if (useStore.getState().city !== district) useStore.getState().setCity(district);
          }}
        >▶ {city === district ? tx("cards.replayHere") : tx("cards.replayEnter")}</button>
      ) : null}
      {source === "real" ? (
        <button className="replay-btn" data-testid="copy-resume" onClick={() => void copyResume(r.faction, r.sessionId, r.cwd)} title={tx("cards.resumeHint")}>{tx("cards.resume")}</button>
      ) : null}
      {got?.error ? <p className="muted">{tx("cards.readFailed", { why: got.error })}</p> : !ds ? <p className="muted">{tx("diary.loading")}</p> : (
        <section>
          <h4>{tx("cards.course", { turns: ds.length, steps })}</h4>
          {ds.map((d, i) => (
            <details key={d.taskId} open={i === 0} className="turn">
              <summary>{tx("cards.turn", { n: i + 1 })} · {i === 0 ? tx("cards.yourRequest") : d.triggerBy === "peer" ? tx("opened.peer") : d.triggerBy === "compact" ? tx("opened.compact") : tx("opened.meta")} · {hms(d.start)} · {formatCount(d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite)} token</summary>
              <Steps steps={d.main} />
              {d.agents.map((a) => (
                <details key={a.agentId} className="agent">
                  <summary>{tx("diary.subSummary", { who: a.agentType ?? a.agentId, n: a.steps.length, tokens: "" }).replace(/ · $/, "")}</summary>
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
  if (!t) return <p className="muted">{tx("cards.townNotInWorld")}</p>;
  const l = w!.layouts.get(district)!;
  return (
    <>
      <small>{t.faction === "codex" ? "Codex" : "Claude Code"} · {themeName(t.theme)}</small>
      <h3>{t.name}</h3>
      {t.skillNote ? <div className="muted">{t.skillNote}</div> : null}
      <div className="row"><span>{tx("card.produced")}</span><b>{tx("cards.producedDrawn", { n: t.counts.produced, d: l.streets.reduce((a, s) => a + s.drawn, 0) })}</b></div>
      <div className="row"><span>{tx("card.investigation")}</span><b>{tx("card.timesN", { n: t.counts.investigation })}</b></div>
      <div className="row"><span>{tx("card.chat")}</span><b>{tx("card.timesN", { n: t.counts.chat + t.counts.empty })}</b></div>
      <section>
        <h4>{tx("cards.streets")}</h4>
        {l.streets.map((s) => <div key={s.name} className="row"><span>{s.name}</span><b>{tx("city.streetSub", { n: s.drawn })}{s.minor ? tx("city.streetMinor", { n: s.minor }) : ""}</b></div>)}
      </section>
      <section>
        <h4>{tx("cards.workHere")}</h4>
        {Object.entries(t.workCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => <div key={k} className="row"><span>{WORK_NAMES[k] ?? k}</span><b>{tx("card.timesN", { n: n.toLocaleString() })}</b></div>)}
      </section>
    </>
  );
}
