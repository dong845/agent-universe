// Hover cards (plan "悬停查看 token"): HTML over the canvas, following the mouse, shown 150 ms after
// the pointer settles. Every number comes from the ledger as of the playback clock.
import { SpotCard } from "../v3/Cards25.tsx";
import { useEffect, useState } from "react";
import { keys, totalOf } from "../../../schema/src/aggregate.ts";
import type { AgentTownEvent, Tokens } from "../../../schema/src/event.ts";
import { BUILDINGS } from "../../../schema/src/world.ts";
import { roleName } from "../i18n/data.ts";
import { activeAt, floorsAt, sampleActor } from "../orchestrator/timeline.ts";
import { TIER_NAMES, TIER_TOKENS } from "../orchestrator/worldgen.ts";
import { absTime, runtimeOf, useStore, type HoverTarget } from "../store.ts";
import { openSessions } from "./counts.ts";
import { t as tx, count } from "../i18n/index.ts";

const SHOW_AFTER_MS = 150;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

export function TokenRows({ t, label = tx("tok.total") }: { t: Tokens; label?: string }) {
  return (
    <>
      <Row k={label} v={count(totalOf(t))} />
      <div className="split">
        <span className="c-input">{tx("tok.input", { n: count(t.input) })}</span>
        <span className="c-output">{tx("tok.output", { n: count(t.output) })}</span>
        <span className="c-cache">{tx("tok.cacheRead", { n: count(t.cacheRead) })}</span>
        <span>{tx("tok.cacheWrite", { n: count(t.cacheWrite) })}</span>
      </div>
    </>
  );
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return tx("diary.s", { n: s });
  if (s < 3600) return tx("diary.ms", { m: Math.floor(s / 60), s: s % 60 });
  if (s < 86400) return tx("diary.hm", { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
  return tx("fmt.d", { n: Math.floor(s / 86400) });
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
  if (!last) return <div className="fresh">{tx("hover.noSpend")}</div>;
  return <div className="fresh">{tx("hover.updated", { t: fmtDur(abs - last.ts) })}</div>;
}

export function CardBody({ target }: { target: HoverTarget }) {
  const { events, ledger, world } = useStore.getState();
  const t = useStore((s) => s.uiT);
  useStore((s) => s.historyAt);
  const abs = absTime(t);

  if (target.kind === "faction") {
    const tk = ledger.tokensAt(keys.faction({ faction: target.faction }), abs);
    const hit = tk.cacheRead + tk.input + tk.cacheWrite ? tk.cacheRead / (tk.cacheRead + tk.input + tk.cacheWrite) : 0;
    const towns = world.districts.filter((d) => d.faction === target.faction);
    return (
      <>
        <h4>{tx("hover.faction", { name: target.faction === "codex" ? "Codex" : "Claude Code" })}<small>{tx("hover.districts", { n: towns.length })}</small></h4>
        <TokenRows t={tk} />
        <Row k={tx("hover.cacheHit")} v={`${(hit * 100).toFixed(1)}%`} />
        <Row k={tx("hover.sessions")} v={String(openSessions(events, abs, (e) => e.faction === target.faction, useStore.getState().unended))} />
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
        <Row k={tx("hover.tasksDone")} v={tx("hover.nItems", { n: d.houses.length + d.olderTasks })} />
        {biggest ? <Row k={tx("hover.priciest")} v={`${biggest.title ?? "—"} · ${count(biggest.tokens)}`} /> : null}
        <Row k={tx("hover.nextTier")} v={next !== undefined ? tx("hover.atTotal", { n: count(next) }) : tx("hover.topTier")} />
        <div className="fresh">{tx("hover.dblClick")}</div>
      </>
    );
  }

  if (target.kind === "house") {
    const h = d.houses.find((x) => x.taskId === target.taskId);
    if (!h) return null;
    return (
      <>
        <h4>{h.ok === null ? tx("hover.stopped") : tx("hover.finished")}<small>{h.ok === null ? tx("outcome.unknown") : h.ok ? tx("outcome.ok") : tx("hover.failedEnd")}</small></h4>
        {h.title ? <div className="task">{h.title}</div> : null}
        <TokenRows t={ledger.tokensAt(keys.task(h.taskId), abs)} label={tx("diary.tokens")} />
        <Row k={tx("hover.height")} v={tx("hover.floors", { n: h.floors })} />
        <Row k={tx("hover.builtAt")} v={tx("hover.ago", { t: fmtDur(abs - h.builtAt) })} />
      </>
    );
  }

  if (target.kind === "building") {
    const b = BUILDINGS.find((x) => x.id === target.id)!;
    const st = ledger.buildingAt(keys.building(d, b.id), abs);
    return (
      <>
        <h4>{b.name}<small>{d.name} · {b.what}</small></h4>
        <Row k={tx("hover.calls")} v={String(st.calls)} />
        <Row k={tx("hover.totalTime")} v={fmtDur(st.durationMs)} />
        <Row k={tx("hover.attributed")} v={count(st.attributedInput)} />
        <div className="fresh">{tx("hover.attributedHint")}</div>
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
          {actor.kind === "commander" ? tx("hover.commander") : actor.agentType === "guardian" ? tx("hover.sentry") : tx("hover.sub", { role: roleName(actor.baseRole) })}
          <small>{d.name}</small>
        </h4>
        {actor.agentTask ? <div className="task">{actor.agentTask}</div> : null}
        <Row k={tx("hover.now")} v={tool ? `${tool.tool} · ${roleName(s.outfit)}` : s.pose === "think" ? tx("hover.thinking") : tx("hover.standby")} />
        {tool?.target ? <div className="target">{tool.target}</div> : null}
        <Row k={tx("hover.stepTokens")} v={s.pose === "think" && lastCall ? count(totalOf(lastCall.tokens!)) : "—"} />
        <TokenRows t={ledger.tokensAt(key, abs)} />
        <Row k={tx("hover.context")} v={`${Math.round(s.backpack * 100)}%`} />
        <Freshness abs={abs} last={lastCall} />
      </>
    );
  }

  if (target.kind === "site") {
    if (!taskId || !task) return null;
    const ended = tl.roofAt !== null && lt >= tl.roofAt;
    const failing = activeAt(tl.smoke, lt);
    const roles = new Set(events.filter((e) => e.ts <= abs && e.taskId === taskId && e.kind === "tool_start" && e.role).map((e) => roleName(e.role!)));
    const lastCall = lastBefore(events, abs, (e) => e.kind === "model_call" && e.taskId === taskId);
    return (
      <>
        <h4>{tx("hover.site")}<small>{ended ? tx("hover.siteDone") : failing ? tx("hover.siteFailing") : tx("hover.siteRunning")}</small></h4>
        {task.title ? <div className="task">{task.title}</div> : null}
        <Row k={tx("hover.elapsed")} v={fmtDur((ended ? tl.roofAt! : lt) - (task.ts - tl.t0))} />
        <Row k={tx("hover.floorsLabel")} v={String(floorsAt(tl, lt).length)} />
        <TokenRows t={ledger.tokensAt(keys.task(taskId), abs)} label={tx("diary.tokens")} />
        <Row k={tx("diary.subTokens")} v={count(totalOf(ledger.tokensAt(keys.taskSubagents(taskId), abs)))} />
        <Row k={tx("hover.roles")} v={[...roles].join(tx("gist.sep")) || "—"} />
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
        <h4>{tx("hover.scaffold")}<small>{actor.agentType}</small></h4>
        {actor.agentTask ? <div className="task">{actor.agentTask}</div> : null}
        <Row k={tx("hover.steps")} v={String(steps)} />
        <TokenRows t={ledger.tokensAt(keys.agent({ sessionId: sid, agentId: actor.id }), abs)} />
        <Row k={tx("hover.elapsed")} v={fmtDur(lt - actor.appear)} />
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
