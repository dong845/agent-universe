// "录制": record the replay being watched (spec 2026-11-01 C). A small dialog (show real names? MP4 or
// GIF?), then the page switches into share mode, the replay starts over, and the recording ends with the
// replay, on "停止", or after 60 s. The banner is HTML outside the recorded picture.
import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useReplay } from "../city/cityReplay.ts";
import { useStore } from "../store.ts";
import { toast } from "../ui/NeedsYou.tsx";
import { fileName } from "./recordFormat.ts";
import { MAX_RECORD_MS, RecordCompositor, useRecorder } from "./recorder.ts";
import { enterShare, leaveShare, type ShareShow } from "./shareMode.ts";
import { t } from "../i18n/index.ts";

/** the dialog and the running recording, outside the Canvas */
export const useRecordUi = create<{ dialog: boolean; running: boolean; show: ShareShow; open(): void; close(): void; setRunning(r: boolean, show?: ShareShow): void }>((set) => ({
  dialog: false,
  running: false,
  show: { townNames: true, titles: false },
  open: () => set({ dialog: true }),
  close: () => set({ dialog: false }),
  setRunning: (running, show = { townNames: true, titles: false }) => set({ running, show, dialog: false }),
}));

/** what the banner says is hidden */
export const hiddenText = (s: ShareShow) => (!s.townNames && !s.titles ? t("rec.hiddenBoth") : !s.townNames ? t("rec.hiddenNames") : !s.titles ? t("rec.hiddenTitles") : "");

let glCanvas: HTMLCanvasElement | null = null;
/** inside the Canvas: knows the WebGL canvas, and paints frames while recording */
export function RecordHost() {
  const { gl } = useThree();
  glCanvas = gl.domElement;
  const running = useRecordUi((s) => s.running);
  return running ? <RecordCompositor /> : null;
}

async function finish(townKey: string | null) {
  const out = await useRecorder.getState().stop();
  useRecordUi.getState().setRunning(false);
  const st = useStore.getState();
  const name = townKey ? st.w25?.towns.get(townKey)?.name ?? "city" : "space";
  leaveShare();
  if (!out || !out.blob.size) return toast(t("rec.empty"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(out.blob);
  a.download = fileName(name, new Date(), out.ext);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  toast(t("rec.saved", { name: a.download, mb: (out.blob.size / 1e6).toFixed(1) }));
}

async function begin(show: ShareShow, format: "mp4" | "gif") {
  if (!glCanvas) return toast(t("rec.notReady"));
  try {
    await enterShare(show);
    useRecordUi.getState().setRunning(true, show);
    const r = useReplay.getState().r;
    if (r) {
      useReplay.getState().seek(0);
      if (!r.playing) useReplay.getState().toggle();
    }
    // two frames for share mode to reach the screen before the first recorded one
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    useRecorder.getState().start(glCanvas, format);
  } catch (e) {
    leaveShare();
    useRecordUi.getState().setRunning(false);
    toast(e instanceof Error ? e.message : String(e));
  }
}

export function RecordDialog() {
  const { dialog, running, show } = useRecordUi();
  const [names, setNames] = useState(true);
  const [titles, setTitles] = useState(false);
  const [format, setFormat] = useState<"mp4" | "gif">("mp4");
  const city = useStore((s) => s.city);
  // the recording ends with the replay, or at the cap
  useEffect(() => {
    if (!running) return;
    const t0 = performance.now();
    const i = setInterval(() => {
      const r = useReplay.getState().r;
      const ended = !r || (!r.playing && r.t >= r.tl.duration);
      if (ended || performance.now() - t0 > MAX_RECORD_MS) void finish(city);
    }, 250);
    return () => clearInterval(i);
  }, [running, city]);
  if (running)
    return (
      <div className="g-rec-banner" data-testid="rec-banner">
        <i />{t("rec.running")}{hiddenText(show)}
        <button onClick={() => void finish(city)}>{t("rec.stop")}</button>
      </div>
    );
  if (!dialog) return null;
  return (
    <div className="g-rec-dialog" data-testid="rec-dialog" role="dialog" aria-label={t("rec.aria")}>
      <b>{t("rec.title")}</b>
      <p className="muted">{t("rec.hint")}</p>
      <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} data-testid="rec-names" /> {t("share.names")}<small>{t("share.namesHint")}</small></label>
      <label><input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} data-testid="rec-titles" /> {t("share.titles")}<small>{t("rec.titlesHint")}</small></label>
      <div className="g-rec-format">
        <label><input type="radio" name="fmt" checked={format === "mp4"} onChange={() => setFormat("mp4")} /> {t("rec.mp4")}</label>
        <label><input type="radio" name="fmt" checked={format === "gif"} onChange={() => setFormat("gif")} /> {t("rec.gif")}</label>
      </div>
      <div className="g-rec-actions">
        <button onClick={() => useRecordUi.getState().close()}>{t("common.cancel")}</button>
        <button className="primary" data-testid="rec-start" onClick={() => void begin({ townNames: names, titles }, format)}>{t("rec.start")}</button>
      </div>
    </div>
  );
}
