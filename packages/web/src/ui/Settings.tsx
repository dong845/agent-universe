// The settings panel (spec 2026-11-01 A3/A5): notification switches and the optional precise hooks,
// which write the agent's own hook file — so the switch says which file, and that a backup is kept.
import { useEffect, useState } from "react";
import { useStore } from "../store.ts";
import { useRightPanel } from "./rightPanel.ts";
import { officialMarks } from "../galaxy/emblem.ts";
import { t } from "../i18n/index.ts";
import { replayTour } from "./Tour.tsx";
import { setSoundsOn, soundsOn } from "./sounds.ts";
import { refreshAskHooks } from "./decision.ts";
import { fetchTownPrefs, keyName, postTown, type TownPrefs } from "./townPrefs.ts";
import { townName } from "../i18n/data.ts";

interface ServerSettings { notify: boolean; notifyTurnDone: boolean; hooks: { claude: boolean; codex: boolean }; askHooks?: { claude: boolean; codex: boolean }; hookFiles?: { claude: string; codex: string } }

const post = async (path: string, body: unknown) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${r.status}`);
  return j;
};

export function Settings() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<ServerSettings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const side = useRightPanel() ? " beside-diary" : "";
  const logosOn = useStore((st) => Object.keys(st.logos).length > 0);
  const [busy, setBusy] = useState(false);
  const [sounds, setSounds] = useState(soundsOn);
  const logos = async () => {
    setBusy(true);
    try {
      await post("/api/logos", { on: !logosOn });
      const l = await (await fetch("/api/logos")).json();
      useStore.getState().setLogos(officialMarks(l));
      setNote(logosOn ? t("settings.logosOff") : t("settings.logosOn"));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const [towns, setTowns] = useState<TownPrefs | null>(null);
  const w = useStore((st) => st.w25);
  const nameOf = (key: string) => { const x = w?.towns.get(key); return x ? townName(x) : keyName(key); };
  const refresh = () => {
    void fetchTownPrefs().then(setTowns);
    return fetch("/api/settings").then((r) => r.json()).then(setS).catch(() => setNote(t("settings.noServer")));
  };
  const undo = async (key: string, change: { hidden: false } | { merge: null }) => {
    const err = await postTown(key, change);
    if (err) setNote(t("town.failed", { why: err }));
    setTowns(await fetchTownPrefs());
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  const flip = async (k: "notify" | "notifyTurnDone") => {
    if (!s) return;
    setS(await post("/api/settings", { [k]: !s[k] }));
  };
  const hooks = async (agent: "claude" | "codex", set: "alerts" | "ask" = "alerts") => {
    if (!s) return;
    try {
      const r = await post("/api/hooks", { agent, on: set === "ask" ? !s.askHooks?.[agent] : !s.hooks[agent], set });
      setNote(r.on
        ? (r.added?.length ? t("settings.hooksAdded", { file: r.file, added: r.added.join(", ") }) + (r.backup ? t("settings.hooksBackup", { backup: r.backup }) : "") : t("settings.hooksThere", { file: r.file }))
        : t("settings.hooksRemoved", { file: r.file, n: r.removed }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    await refresh();
    void refreshAskHooks();
  };
  return (
    <>
      <button className={`g-gear${side}`} data-testid="settings" title={t("settings.title")} onClick={() => setOpen(!open)}>⚙</button>
      {open && s ? (
        <div className={`g-settings${side}`} data-testid="settings-panel">
          <label><input type="checkbox" checked={s.notify} onChange={() => void flip("notify")} /> {t("settings.notify")}</label>
          <label><input type="checkbox" checked={s.notifyTurnDone} disabled={!s.notify} onChange={() => void flip("notifyTurnDone")} /> {t("settings.notifyDone")}</label>
          <hr />
          <p className="muted">{t("settings.hooksHint")}</p>
          <label><input type="checkbox" checked={s.hooks.claude} onChange={() => void hooks("claude")} /> {t("settings.hooks")} · Claude Code<small>{s.hookFiles?.claude}</small></label>
          <label><input type="checkbox" checked={s.hooks.codex} onChange={() => void hooks("codex")} /> {t("settings.hooks")} · Codex<small>{s.hookFiles?.codex}</small></label>
          <hr />
          <p className="muted">{t("settings.askHint")}</p>
          <label><input type="checkbox" checked={!!s.askHooks?.claude} onChange={() => void hooks("claude", "ask")} data-testid="ask-hook-claude" /> {t("settings.askHooks")} · Claude Code<small>{s.hookFiles?.claude}</small></label>
          <label><input type="checkbox" checked={!!s.askHooks?.codex} onChange={() => void hooks("codex", "ask")} data-testid="ask-hook-codex" /> {t("settings.askHooks")} · Codex<small>{s.hookFiles?.codex}</small></label>
          <hr />
          <label><input type="checkbox" checked={logosOn} disabled={busy} onChange={() => void logos()} data-testid="logos" /> {t("settings.logos")}<small>{t("settings.logosHint")}</small></label>
          <hr />
          <label><input type="checkbox" checked={sounds} onChange={() => { setSoundsOn(!sounds); setSounds(!sounds); }} data-testid="sounds" /> {t("settings.sounds")}<small>{t("settings.soundsHint")}</small></label>
          <hr />
          <p className="muted">{t("settings.towns")} · {t("settings.townsHint")}</p>
          {towns && (towns.hidden.length || Object.keys(towns.merge).length) ? (
            <ul className="g-settings-towns" data-testid="settings-towns">
              {towns.hidden.map((k) => <li key={`h|${k}`}><span>{nameOf(k)} <small>{t("town.hiddenTag")}</small></span><button onClick={() => void undo(k, { hidden: false })} data-testid="town-show">{t("settings.show")}</button></li>)}
              {Object.entries(towns.merge).map(([k, to]) => <li key={`m|${k}`}><span>{keyName(k)} → {nameOf(to)}</span><button onClick={() => void undo(k, { merge: null })} data-testid="town-unmerge">{t("settings.unmerge")}</button></li>)}
            </ul>
          ) : null}
          <hr />
          <button className="g-settings-btn" onClick={() => { setOpen(false); replayTour(); }} data-testid="tour-replay">{t("tour.replay")}</button>
          {note ? <p className="g-settings-note">{note}</p> : null}
        </div>
      ) : null}
    </>
  );
}
