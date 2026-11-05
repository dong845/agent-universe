// "导出分享页" (spec 2026-11-01 D): one HTML file of this world that others can open and turn. Names are
// hidden unless switched on; up to 5 requests can go along as replays.
import { useMemo, useState } from "react";
import { useStore } from "../store.ts";
import { useRightPanel } from "../ui/rightPanel.ts";
import { toast } from "../ui/NeedsYou.tsx";
import { t, useLang } from "../i18n/index.ts";

const MAX_REPLAYS = 5;

export function ExportShare() {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState(true);
  const [titles, setTitles] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const w = useStore((s) => s.w25);
  const side = useRightPanel() ? " beside-diary" : "";
  // the most recent finished products, the ones worth showing
  const recent = useMemo(() => [...(w?.requests.values() ?? [])].filter((r) => r.class === "produced" && r.ok !== null).sort((a, b) => b.endTs - a.endTs).slice(0, 12), [w]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/export/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ townNames: names, titles, replays: picked, lang: useLang.getState().lang }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "agent-universe-share.html";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      toast(t("export.saved", { name, mb: (blob.size / 1e6).toFixed(1), big: blob.size > 15e6 ? t("export.big") : "" }));
      setOpen(false);
    } catch (e) {
      toast(t("export.failed", { why: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={`g-export${side}`} data-testid="export-share" onClick={() => setOpen(!open)} title={t("export.buttonHint")}>{t("export.button")}</button>
      {open ? (
        <div className="g-rec-dialog g-export-dialog" data-testid="export-dialog" role="dialog" aria-label={t("export.title")}>
          <b>{t("export.title")}</b>
          <p className="muted">{t("export.hint")}</p>
          <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> {t("share.names")}<small>{t("share.namesHint")}</small></label>
          <label><input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} /> {t("share.titles")}<small>{t("export.titlesHint")}</small></label>
          <p className="muted">{t("export.replays", { n: MAX_REPLAYS })}</p>
          <div className="g-export-list">
            {recent.map((r) => (
              <label key={r.requestId}>
                <input type="checkbox" checked={picked.includes(r.requestId)} disabled={!picked.includes(r.requestId) && picked.length >= MAX_REPLAYS}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, r.requestId] : picked.filter((x) => x !== r.requestId))} />
                <span>{w?.towns.get(`${r.faction}|${r.projectId}`)?.name} · {r.title ?? t("history.untitled")}</span>
              </label>
            ))}
          </div>
          <div className="g-rec-actions">
            <button onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button className="primary" disabled={busy} data-testid="export-go" onClick={() => void go()}>{busy ? t("export.busy") : t("export.go")}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
