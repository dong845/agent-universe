// The task diary (spec 4): opens beside the world when a house, site or figure is selected and
// tells that task's whole story — every step, its tokens, rework, and a replay on the town's site.
import { useEffect, useMemo, useState } from "react";
import type { AgentTownEvent } from "../../../schema/src/event.ts";
import { roleName } from "../i18n/data.ts";
import { fetchTask } from "../data.ts";
import { useStore } from "../store.ts";
import { districtKey } from "../orchestrator/worldgen.ts";
import { diaryOf, taskOfSelection, type Diary as DiaryT, type DiaryStep } from "./diaryModel.ts";
import { TokenRows } from "./HoverCard.tsx";
import { RequestDiary, TownPanel } from "../v3/Cards25.tsx";
import { t, count } from "../i18n/index.ts";

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
  if (s < 60) return t("diary.s", { n: s });
  if (s < 3600) return t("diary.ms", { m: Math.floor(s / 60), s: s % 60 });
  return t("diary.hm", { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
}
const OUTCOME = { ok: t("outcome.ok"), error: t("outcome.error"), unknown: t("outcome.unknown"), running: t("outcome.running") } as const;
const OPENED_BY = { peer: t("opened.peer"), compact: t("opened.compact"), meta: t("opened.meta"), other: t("opened.meta") } as const;
const PLACED = { files: t("placed.files"), inferred: t("placed.inferred"), cwd: t("placed.cwd") } as const;

function Step({ s }: { s: DiaryStep }) {
  return (
    <div className={`step ${s.status === "error" || s.status === "denied" ? "bad" : ""}`} data-step>
      <span className="when">{hms(s.ts)}</span>
      <span className="role">{s.role ? roleName(s.role) : "—"}</span>
      <span className="tool">{s.tool}{s.status === "denied" ? t("step.denied") : s.status === "error" ? t("step.error") : s.status === "running" ? t("step.running") : ""}</span>
      <span className="tk">{s.tokens ? count(s.tokens) : "—"}</span>
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
      {steps.length > shown.length ? <button className="more" onClick={() => setAll(true)}>{t("diary.more", { n: steps.length - shown.length })}</button> : null}
    </>
  );
}

/** the diary beside the world: a request's story, a town's summary, or (older links) one turn */
export function Diary() {
  const selected = useStore((s) => s.selected);
  if (selected?.kind === "request" || selected?.kind === "town") {
    return (
      <aside className="diary" data-testid="diary">
        <header>
          <button className="back" onClick={() => useStore.getState().back()} aria-label={t("diary.backAria")}>{t("diary.back")}</button>
        </header>
        {selected.kind === "request" ? <RequestDiary district={selected.district} requestId={selected.requestId} /> : <TownPanel district={selected.district} />}
      </aside>
    );
  }
  return <TaskDiary />;
}

function TaskDiary() {
  const selected = useStore((s) => s.selected);
  const events = useStore((s) => s.events);
  const live = useStore((s) => s.live);
  const replay = useStore((s) => s.replay);
  const world = useStore((s) => s.world);
  const taskId = useMemo(() => taskOfSelection(selected, events, live, replay), [selected, events, live, replay]);
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
        <button className="back" onClick={() => useStore.getState().back()} aria-label={t("diary.backAria")}>{t("diary.back")}</button>
        <small>{town ? `${town.faction === "codex" ? "Codex" : "Claude Code"} · ${town.name}` : ""}</small>
      </header>
      {!taskId ? (
        <p className="muted">{t("diary.noTask")}</p>
      ) : got?.error ? (
        <p className="muted">{t("diary.failed", { why: got.error })}</p>
      ) : !d ? (
        <p className="muted">{t("diary.loading")}</p>
      ) : (
        <>
          <h3>{d.title ?? (d.continues ? t("worldgen.continues", { title: d.continues }) : t("diary.untitledSystem"))}</h3>
          <div className="meta">{d.triggerBy ? `${OPENED_BY[d.triggerBy]} · ` : ""}{d.models.join(t("gist.sep")) || t("diary.noModel")}{d.projectBy ? t("diary.placed", { how: PLACED[d.projectBy] }) : ""}</div>
          <div className="row"><span>{t("diary.start")}</span><b>{dateTime(d.start)}</b></div>
          <div className="row"><span>{t("diary.end")}</span><b>{d.end !== null ? dateTime(d.end) : "—"}</b></div>
          <div className="row"><span>{t("diary.took")}</span><b>{d.end !== null ? dur(d.end - d.start) : "—"}</b></div>
          <div className={`row outcome-${d.outcome}`}><span>{t("diary.result")}</span><b>{OUTCOME[d.outcome]}</b></div>
          <TokenRows t={d.tokens} label={t("diary.tokens")} />
          <div className="row"><span>{t("diary.subTokens")}</span><b>{count(d.subagentTokens)}</b></div>
          <button
            className="replay"
            disabled={!d.replayable || replay?.taskId === d.taskId}
            title={d.replayable ? t("diary.replayHint") : t("diary.noReplay")}
            onClick={() => got?.events?.length && useStore.getState().startReplay(districtKey(got.events[0]), got.events)}
          >
            {t("diary.replay")}
          </button>
          {d.rework.length ? (
            <section>
              <h4>{t("diary.rework")}</h4>
              {d.rework.map((r) => <div key={r.file} className="row"><span className="target">{r.file}</span><b>{t("diary.editsN", { n: r.edits })}</b></div>)}
            </section>
          ) : null}
          <section>
            <h4>{t("diary.steps", { n: d.main.length })}</h4>
            <div className="stephead"><span>{t("diary.colTime")}</span><span>{t("diary.colRole")}</span><span>{t("diary.colTool")}</span><span>token</span></div>
            <Steps steps={d.main} />
          </section>
          {d.agents.map((a) => (
            <details key={a.agentId} className="agent">
              <summary>{t("diary.subSummary", { who: a.agentType ?? a.agentId, n: a.steps.length, tokens: count(a.tokens) })}</summary>
              {a.agentTask ? <div className="task">{a.agentTask}</div> : null}
              <Steps steps={a.steps} />
            </details>
          ))}
        </>
      )}
    </aside>
  );
}
