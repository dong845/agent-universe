// The mini window (spec 2026-11-05 C2): a small always-on-top window (Document Picture-in-Picture, desktop
// Chrome/Edge) listing the sessions waiting on you and the ones at work, each with the character's face.
// DOM only; it reads the same store as the page. Hidden where the browser lacks the API.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Face2D } from "../character/Face2D.tsx";
import { workName, duration } from "../city/history.ts";
import { t, useLang } from "../i18n/index.ts";
import { absTime, useStore } from "../store.ts";
import { miniRows, type MiniRow } from "./miniRows.ts";
import { copyResume, STATE_TEXT } from "./NeedsYou.tsx";

interface PipApi { requestWindow(o: { width: number; height: number }): Promise<Window>; window: Window | null }
const pip = (): PipApi | undefined => (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;

/** the page's styles, copied into the little window */
function copyStyles(to: Document) {
  for (const sheet of [...document.styleSheets]) {
    try {
      const css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      const s = to.createElement("style");
      s.textContent = css;
      to.head.appendChild(s);
    } catch {
      if (sheet.href) {
        const l = to.createElement("link");
        l.rel = "stylesheet";
        l.href = sheet.href;
        to.head.appendChild(l);
      }
    }
  }
}

function Rows() {
  useLang();
  const w = useStore((s) => s.w25);
  const events = useStore((s) => s.events);
  const attention = useStore((s) => s.attention);
  const closed = useStore((s) => s.closedAttention);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(h);
  }, []);
  // the working rows go by the scene's clock (live: now; the demo: its own time)
  const clock = absTime(useStore.getState().t);
  const rows = useMemo(() => (w ? miniRows({ w, events, attention, closed, now, clock, names: (k) => w.towns.get(k)?.name ?? k.split("/").filter(Boolean).pop() ?? k }) : { attention: [], live: [] }), [w, events, attention, closed, now]);
  const row = (r: MiniRow) => {
    const req = r.attention?.requestId ? w?.requests.get(r.attention.requestId) : undefined;
    return (
      <div key={r.key} className={`g-mini-row${r.attention ? ` s-${r.state}` : ""}`} data-testid="mini-row">
        <Face2D face={r.face} faction={r.faction} size={34} />
        <div className="g-mini-text">
          <b>{r.town}</b>
          <span>{r.state ? STATE_TEXT[r.state] : r.doing ? [r.doing.role ? workName(r.doing.role) : null, r.doing.tool].filter(Boolean).join(" · ") : t("mini.thinking")}{` · ${duration(r.sinceMs)}`}</span>
        </div>
        {r.attention ? (
          <>
            <button onClick={() => void copyResume(r.attention!.faction, r.attention!.sessionId, req?.cwd)} title={t("mini.copy")}>⧉</button>
            <button onClick={() => useStore.getState().closeAttention(r.attention!)} aria-label={t("common.close")}>×</button>
          </>
        ) : null}
      </div>
    );
  };
  return (
    <div className="g-mini" data-testid="mini-body">
      <header>
        <b>Agent Universe</b>
        <button onClick={() => window.focus()} data-testid="mini-back">{t("mini.back")}</button>
      </header>
      {rows.attention.length ? <h4>{t("mini.needs", { n: rows.attention.length })}</h4> : null}
      {rows.attention.map(row)}
      <h4>{t("mini.working", { n: rows.live.length })}</h4>
      {rows.live.length ? rows.live.map(row) : <p className="g-mini-none">{t("mini.none")}</p>}
    </div>
  );
}

export function MiniWindow() {
  useLang();
  const source = useStore((s) => s.source);
  const [host, setHost] = useState<HTMLElement | null>(null);
  if (!pip() || source === "share") return null;
  const open = async () => {
    const api = pip()!;
    if (api.window) return api.window.focus();
    const win = await api.requestWindow({ width: 340, height: 440 });
    copyStyles(win.document);
    win.document.body.className = "g-mini-doc";
    const el = win.document.createElement("div");
    win.document.body.appendChild(el);
    win.addEventListener("pagehide", () => setHost(null));
    setHost(el);
  };
  return (
    <>
      <button className="g-mini-btn" onClick={() => void open()} data-testid="mini-open" title={t("mini.title")}>{t("mini.button")}</button>
      {host ? createPortal(<Rows />, host) : null}
    </>
  );
}
