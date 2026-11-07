// The followed agent's card (spec 2026-11-05 C1): its face, who it is, what it is doing now and for how
// long, its tokens so far, and the subagents it sent (click one to follow it instead) and its parent.
import { useEffect, useMemo, useState } from "react";
import { Face2D } from "../character/Face2D.tsx";
import { t, useLang, count } from "../i18n/index.ts";
import { absTime, useStore } from "../store.ts";
import { agentFacts, agentIdOf } from "./agentFacts.ts";
import { duration, useHistory, workName } from "./history.ts";
import { robotInfo } from "./Robot.tsx";
import { useReplay } from "./cityReplay.ts";
import { WORK_COLOR } from "../galaxy/galaxyData.ts";
import { uniqueAgents } from "../orchestrator/sessionAgents.ts";

/** the robot that shows an agent, in the same group (live, history step or replay) as `like` */
function robotOf(agentId: string, like: string): string | undefined {
  const group = like.split("|")[0];
  for (const id of robotInfo.keys()) if (id.split("|")[0] === group && agentIdOf(id) === agentId) return id;
  return undefined;
}

export function FollowCard({ faction }: { faction: "claude-code" | "codex" }) {
  useLang();
  const id = useStore((s) => s.followAgent);
  const share = useStore((s) => s.share);
  const titles = useStore((s) => s.shareTitles);
  const historyEvents = useHistory((s) => s.events?.ev ?? null);
  // the card follows the clock: a few times a second is enough
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id) return;
    const h = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(h);
  }, [id]);
  const events = useStore((s) => s.events);
  const live = useStore((s) => s.live);
  const st = useStore.getState();
  const hist = id?.startsWith("hist|");
  // live: the requests in progress only (a main agent's session can span hundreds of requests)
  const liveEvents = useMemo(() => uniqueAgents(events.filter((e) => e.taskId && live.has(e.taskId))), [events, live]);
  const histEvents = useMemo(() => uniqueAgents(historyEvents ?? []), [historyEvents]);
  const replay = useReplay((s) => (id?.startsWith("rp|") ? s.r : null));
  const evs = hist ? histEvents : replay ? replay.events : liveEvents;
  // a history step stands at its end; a replay at its own clock; live is now
  const now = hist ? (st.historyAt ?? Infinity) : replay ? replay.tl.t0 + replay.t : absTime(st.t);
  const agentId = id ? agentIdOf(id) : null;
  const facts = useMemo(() => (agentId ? agentFacts(evs, agentId, now, { share, titles }) : null), [evs, agentId, now, share, titles]);
  // an agent with nothing on record here (the share page carries no events): no card rather than a wrong one
  if (!id || !facts || !facts.seen) return null;
  const info = robotInfo.get(id);
  const accent = facts.doing ? WORK_COLOR[facts.doing.role] : undefined;
  const follow = (a: string) => {
    const r = robotOf(a, id);
    if (r) useStore.getState().setFollowAgent(r);
  };
  return (
    <div className="g-follow" data-testid="follow-card">
      <button className="g-x" onClick={() => useStore.getState().setFollowAgent(null)} aria-label={t("common.close")} data-testid="follow-close">×</button>
      <div className="g-follow-head">
        <Face2D face={info?.face ?? "normal"} faction={faction} size={56} accent={facts.kind === "sub" ? accent : undefined} prop={info?.prop ?? null} />
        <div>
          <b>{facts.kind === "main" ? t("follow.main") : t("follow.sub")}{facts.agentType ? ` · ${facts.agentType}` : ""}</b>
          {facts.task ? <small className="g-follow-task">{facts.task}</small> : null}
        </div>
      </div>
      <div className="g-follow-row" data-testid="follow-doing">
        <span>{t("follow.doing")}</span>
        <b>{facts.doing ? [workName(facts.doing.role), facts.doing.tool, facts.doing.target].filter(Boolean).join(" · ") : t("follow.idle")}</b>
      </div>
      <div className="g-follow-row"><span>{t("follow.since")}</span><b>{duration(facts.sinceMs)}</b></div>
      <div className="g-follow-row"><span>token</span><b>{count(facts.tokens)}</b></div>
      {facts.children.length ? (
        <div className="g-follow-kids">
          <span>{t("follow.children", { n: facts.children.length })}</span>
          {facts.children.map((c) => <button key={c} onClick={() => follow(c)} disabled={!robotOf(c, id)} data-testid="follow-child">{agentFacts(evs, c, now, { share, titles }).agentType ?? c.slice(0, 6)}</button>)}
        </div>
      ) : null}
      {facts.parent ? <button className="g-follow-parent" onClick={() => follow(facts.parent!)} disabled={!robotOf(facts.parent, id)}>{t("follow.parent")}</button> : null}
    </div>
  );
}
