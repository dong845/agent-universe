// The city's right panel (spec 2026-11-05 D26 C): two tabs, Overview and History. A city opens on its
// Overview — how big the project is — and History is one click away (the step list, D23).
import { useMemo } from "react";
import { create } from "zustand";
import { formatCount } from "../../../schema/src/aggregate.ts";
import { WORK_COLOR, PRODUCT_COLOR } from "../galaxy/galaxyData.ts";
import { townName } from "../i18n/data.ts";
import { t, useLang, type Key } from "../i18n/index.ts";
import { absTime, useStore } from "../store.ts";
import { historySteps, useHistory } from "./history.ts";
import { closeHistory, goToStep } from "./HistoryPanel.tsx";
import { townOverview } from "./overview.ts";
import { useReplay } from "./cityReplay.ts";

/** whether the Overview tab shows (History shows while a step is open) */
export const useCityPanel = create<{ overview: boolean; setOverview(o: boolean): void }>((set) => ({ overview: true, setOverview: (overview) => set({ overview }) }));

/** the two tabs, on top of either panel */
export function CityTabs({ town, on }: { town: string; on: "overview" | "history" }) {
  useLang();
  const w = useStore((s) => s.w25);
  const steps = useMemo(() => (w ? historySteps(w, town) : []), [w, town]);
  const toHistory = () => {
    if (!steps.length) return;
    useHistory.getState().open(town, steps.length);
    goToStep(steps, steps.length);
  };
  const toOverview = () => {
    closeHistory();
    useCityPanel.getState().setOverview(true);
  };
  return (
    <nav className="g-tabs" role="tablist">
      <button role="tab" aria-selected={on === "overview"} className={on === "overview" ? "on" : ""} onClick={toOverview} data-testid="tab-overview">{t("overview.tab")}</button>
      <button role="tab" aria-selected={on === "history"} className={on === "history" ? "on" : ""} onClick={toHistory} disabled={!steps.length} data-testid="tab-history">{t("overview.historyTab", { n: steps.length })}</button>
    </nav>
  );
}

const day = (ts: number | null) => (ts === null ? "—" : new Date(ts).toISOString().slice(0, 10));
const sw = (c: string | undefined) => <i className="sw" style={{ background: c ?? "#888" }} />;

export function OverviewPanel() {
  useLang();
  const city = useStore((s) => s.city);
  const on = useCityPanel((s) => s.overview);
  const history = useHistory((s) => !!s.town);
  const w = useStore((s) => s.w25);
  // a replay has the city to itself, as it does with the history (the panel covered the replay bar's end button)
  const replaying = useReplay((s) => !!s.r);
  const o = useMemo(() => (city && w ? townOverview(w, city, absTime(useStore.getState().t)) : null), [city, w]);
  if (!city || !on || history || replaying || !o || !w) return null;
  const town = w.towns.get(city);
  const row = (k: Key, v: React.ReactNode, testid?: string) => <div className="row" data-testid={testid}><span>{t(k)}</span><b>{v}</b></div>;
  return (
    <aside className="g-history g-overview" data-testid="overview">
      <header>
        <b>{town ? townName(town) : ""}</b>
        <button onClick={() => useCityPanel.getState().setOverview(false)} aria-label={t("common.close")} data-testid="overview-close">✕</button>
      </header>
      <CityTabs town={city} on="overview" />
      <div className="g-overview-body">
        <h5>{t("overview.scale")}</h5>
        {row("overview.requests", t("overview.requestsN", { n: o.requests.total, p: o.requests.produced, i: o.requests.investigation, c: o.requests.chat }), "overview-requests")}
        {row("overview.tokens", formatCount(o.tokens))}
        {row("overview.active", t("overview.activeN", { n: o.activeDays, s: o.streak }))}
        {row("overview.span", `${day(o.first)} → ${day(o.last)}`)}
        {o.liveNow ? row("overview.live", String(o.liveNow)) : null}
        {o.products.length ? (<><h5>{t("overview.products")}</h5><div className="chips">{o.products.map((p) => <span key={p.kind}>{sw(PRODUCT_COLOR[p.kind])}{t(`product.${p.kind}` as Key)} <b>{p.n}</b></span>)}</div></>) : null}
        <h5>{t("overview.built")}</h5>
        {row("overview.houses", t("overview.housesN", { n: o.built.houses, of: o.requests.produced }))}
        {row("overview.tents", t("overview.housesN", { n: o.built.tents, of: o.requests.investigation }))}
        {row("overview.streets", String(o.built.streets))}
        {o.built.public.length ? <div className="chips">{o.built.public.map((p) => <span key={p.work}>{sw(WORK_COLOR[p.work])}{t(`work.${p.work}` as Key)} <b>{p.n.toLocaleString()}</b></span>)}</div> : null}
        {o.work.length ? (<><h5>{t("overview.work")}</h5>{o.work.map((x) => <div key={x.role} className="g-bar"><span>{t(`work.${x.role}` as Key)}</span><i style={{ width: `${(x.n / o.work[0].n) * 100}%`, background: WORK_COLOR[x.role] }} /><b>{x.n.toLocaleString()}</b></div>)}</>) : null}
        {row("overview.spawns", String(o.spawns))}
        {o.skills.length ? (<><h5>{t("overview.skills")}</h5><div className="chips">{o.skills.slice(0, 8).map((s) => <span key={s.name}>{s.name} <b>{s.n}</b></span>)}</div></>) : null}
        <p className="muted">{t("overview.note")}</p>
      </div>
    </aside>
  );
}
