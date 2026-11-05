// The review poster dialog (spec 2026-11-05 C3): pick a period and whether project names show; the
// poster is drawn from the requests with a shot of the universe behind (taken in share mode, so the
// marks are the neutral ones and nothing private is on screen), previewed, and saved as a PNG.
import { useEffect, useRef, useState } from "react";
import { faceSvg } from "../character/faceSvg.ts";
import { t, useLang } from "../i18n/index.ts";
import { absTime, useStore } from "../store.ts";
import { toast } from "../ui/NeedsYou.tsx";
import { grabFrame } from "./grab.ts";
import { drawPoster, POSTER } from "./poster.ts";
import { reviewStats, type Period } from "./review.ts";
import { enterShare, leaveShare } from "./shareMode.ts";
import { demoCodeNames } from "./display.ts";

const PERIODS: Period[] = ["week", "month", "year", "all"];
const nextFrames = (n: number) => new Promise<void>((r) => { const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : r()); step(n); });
const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("image")); i.src = src; });

export function posterFileName(period: Period, d: Date) {
  return `agent-universe-review-${period}-${d.toISOString().slice(0, 10)}.png`;
}

export function PosterButton() {
  useLang();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("week");
  const [names, setNames] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bg, setBg] = useState<HTMLCanvasElement | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  // the background is taken once per opening, under share mode
  useEffect(() => {
    if (!open) return setBg(null);
    let gone = false;
    void (async () => {
      const was = useStore.getState().share;
      if (!was) await enterShare({ townNames: names, titles: false });
      await nextFrames(3);
      const c = await grabFrame();
      if (!was) leaveShare();
      if (!gone) setBg(c);
    })();
    return () => { gone = true; };
  }, [open]);
  const draw = async (canvas: HTMLCanvasElement) => {
    const st = useStore.getState();
    const w = st.realW25 ?? st.w25;
    if (!w) return null;
    const face = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg({ face: "happy", faction: "claude-code", size: 340 }))}`);
    const s = reviewStats([...w.requests.values()], period, absTime(st.t), { events: st.events });
    // names off: the same code names a share export uses (this machine's own on real data)
    const codes = names ? null : st.source === "real" ? ((await (await fetch("/api/share/names")).json()) as Record<string, string>) : demoCodeNames([...w.towns.keys()]);
    const nameOf = (k: string) => (codes ? codes[k] ?? "—" : w.towns.get(k)?.name ?? k.split("/").filter(Boolean).pop() ?? k);
    canvas.width = POSTER.w;
    canvas.height = POSTER.h;
    return drawPoster(canvas.getContext("2d")!, s, { bg, face, lang: useLang.getState().lang, period, names: nameOf });
  };
  useEffect(() => {
    if (open && preview.current) void draw(preview.current);
  });
  const save = async () => {
    setBusy(true);
    try {
      const c = document.createElement("canvas");
      await draw(c);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("PNG");
      const name = posterFileName(period, new Date(absTime(useStore.getState().t)));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      toast(t("poster.saved", { name }));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="g-export" data-testid="poster-open" onClick={() => setOpen(!open)}>{t("poster.button")}</button>
      {open ? (
        <div className="g-rec-dialog g-poster-dialog" data-testid="poster-dialog" role="dialog" aria-label={t("poster.title")}>
          <b>{t("poster.title")}</b>
          <p className="muted">{t("poster.hint")}</p>
          <div className="g-poster-periods">
            {PERIODS.map((p) => <button key={p} className={p === period ? "on" : ""} onClick={() => setPeriod(p)} data-testid={`poster-${p}`}>{t(`poster.${p}`)}</button>)}
          </div>
          <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> {t("poster.names")}<small>{t("poster.namesHint")}</small></label>
          <canvas ref={preview} className="g-poster-preview" data-testid="poster-preview" />
          <div className="g-rec-actions">
            <button onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button className="primary" disabled={busy} data-testid="poster-save" onClick={() => void save()}>{t("poster.save")}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
