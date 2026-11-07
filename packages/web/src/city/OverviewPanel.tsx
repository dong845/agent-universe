// The city's right panel (spec 2026-11-05 D26 C): two tabs, Overview and History. A city opens on its
// Overview — how big the project is — and History is one click away (the step list, D23).
import { useMemo, useState } from "react";
import { create } from "zustand";
import { WORK_COLOR, PRODUCT_COLOR } from "../galaxy/galaxyData.ts";
import { townName } from "../i18n/data.ts";
import type { TownRow } from "../../../schema/src/towns.ts";
import { t, useLang, type Key, count } from "../i18n/index.ts";
import { absTime, useStore } from "../store.ts";
import { historySteps, useHistory } from "./history.ts";
import { closeHistory, goToStep } from "./HistoryPanel.tsx";
import { townOverview } from "./overview.ts";
import { useReplay } from "./cityReplay.ts";
import { mergeTargets, postTown, townNote } from "../ui/townPrefs.ts";
import { toast } from "../ui/NeedsYou.tsx";

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
  const source = useStore((s) => s.source);
  // a replay has the city to itself, as it does with the history (the panel covered the replay bar's end button)
  const replaying = useReplay((s) => !!s.r);
  const o = useMemo(() => (city && w ? townOverview(w, city, absTime(useStore.getState().t)) : null), [city, w]);
  if (!city || !on || history || replaying || !o || !w) return null;
  const town = w.towns.get(city);
  const row = (k: Key, v: React.ReactNode, testid?: string) => <div className="row" data-testid={testid}><span>{t(k)}</span><b>{v}</b></div>;
  const note = town ? townNote(town) : null;
  return (
    <aside className="g-history g-overview" data-testid="overview">
      <header>
        {town ? <TownTitle key={town.key} town={town} editable={source === "real"} /> : <b />}
        <button onClick={() => useCityPanel.getState().setOverview(false)} aria-label={t("common.close")} data-testid="overview-close">✕</button>
      </header>
      {note ? <p className="muted g-town-note" data-testid="town-note">{note}</p> : null}
      <CityTabs town={city} on="overview" />
      <div className="g-overview-body">
        <h5>{t("overview.scale")}</h5>
        {row("overview.requests", t("overview.requestsN", { n: o.requests.total, p: o.requests.produced, i: o.requests.investigation, c: o.requests.chat }), "overview-requests")}
        {row("overview.tokens", count(o.tokens))}
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
        {town && source === "real" ? <TownActions town={town} towns={[...w.towns.values()]} /> : null}
      </div>
    </aside>
  );
}

/** the town's name; ✎ edits it in place (D27 A2): Enter saves, empty gives the folder's name back, Esc cancels */
function TownTitle({ town, editable }: { town: TownRow; editable: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  const save = async (v: string) => {
    setEdit(null);
    if (v.trim() === town.name) return;
    const err = await postTown(town.key, { name: v.trim() || null });
    if (err) toast(t("town.failed", { why: err }));
  };
  if (edit !== null) {
    return (
      <input className="g-town-name" autoFocus value={edit} maxLength={60} placeholder={town.folderName ?? townName(town)} title={t("town.renameHint")} data-testid="town-name-input"
        onChange={(e) => setEdit(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") void save(edit); else if (e.key === "Escape") setEdit(null); }}
        onBlur={() => setEdit(null)} />
    );
  }
  return (
    <b className="g-town-title" title={town.folderName ? t("town.folder", { name: town.folderName }) : undefined} data-testid="town-name">
      {townName(town)}
      {editable ? <button className="g-town-edit" onClick={() => setEdit(town.name)} aria-label={t("town.rename")} title={t("town.rename")} data-testid="town-rename">✎</button> : null}
    </b>
  );
}

/** hide from space, merge into another planet (D27 A3/A4); undo lives in Settings */
function TownActions({ town, towns }: { town: TownRow; towns: TownRow[] }) {
  const targets = mergeTargets(towns, town.key);
  const hide = async () => {
    const err = await postTown(town.key, { hidden: !town.hidden });
    toast(err ? t("town.failed", { why: err }) : t(town.hidden ? "town.shownToast" : "town.hiddenToast", { name: townName(town) }));
  };
  const merge = async (to: string) => {
    if (!to) return;
    const err = await postTown(town.key, { merge: to });
    const target = towns.find((x) => x.key === to);
    toast(err ? t("town.failed", { why: err }) : t("town.mergedToast", { name: townName(town), to: target ? townName(target) : to }));
  };
  return (
    <div className="g-town-actions">
      <button onClick={() => void hide()} data-testid="town-hide">{town.hidden ? t("town.show") : t("town.hide")}</button>
      {targets.length ? (
        <select value="" onChange={(e) => void merge(e.target.value)} title={t("town.mergeHint")} data-testid="town-merge">
          <option value="">{t("town.mergeInto")}</option>
          {targets.map((x) => <option key={x.key} value={x.key}>{townName(x)}</option>)}
        </select>
      ) : null}
    </div>
  );
}
