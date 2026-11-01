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
import { enterShare, leaveShare } from "./shareMode.ts";

/** the dialog and the running recording, outside the Canvas */
export const useRecordUi = create<{ dialog: boolean; running: boolean; realNames: boolean; open(): void; close(): void; setRunning(r: boolean, realNames?: boolean): void }>((set) => ({
  dialog: false,
  running: false,
  realNames: false,
  open: () => set({ dialog: true }),
  close: () => set({ dialog: false }),
  setRunning: (running, realNames = false) => set({ running, realNames, dialog: false }),
}));

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
  if (!out || !out.blob.size) return toast("录制没有得到画面");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(out.blob);
  a.download = fileName(name, new Date(), out.ext);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  toast(`已保存 ${a.download}（${(out.blob.size / 1e6).toFixed(1)} MB）`);
}

async function begin(realNames: boolean, format: "mp4" | "gif") {
  if (!glCanvas) return toast("画面还没准备好");
  try {
    await enterShare(realNames);
    useRecordUi.getState().setRunning(true, realNames);
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
  const { dialog, running, realNames } = useRecordUi();
  const [names, setNames] = useState(false);
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
        <i />录制中{realNames ? "" : " · 已隐藏真实名称"}
        <button onClick={() => void finish(city)}>停止</button>
      </div>
    );
  if (!dialog) return null;
  return (
    <div className="g-rec-dialog" data-testid="rec-dialog" role="dialog" aria-label="录制重放">
      <b>录制这次重放</b>
      <p className="muted">从头录到结束（最长 60 秒）。录的是你屏幕上的画面：开始后会换成代号和我们自己的阵营标志。</p>
      <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> 显示真实名称<small>项目名会出现在视频里</small></label>
      <div className="g-rec-format">
        <label><input type="radio" name="fmt" checked={format === "mp4"} onChange={() => setFormat("mp4")} /> 视频（MP4）</label>
        <label><input type="radio" name="fmt" checked={format === "gif"} onChange={() => setFormat("gif")} /> 动图（GIF，较大较糊）</label>
      </div>
      <div className="g-rec-actions">
        <button onClick={() => useRecordUi.getState().close()}>取消</button>
        <button className="primary" data-testid="rec-start" onClick={() => void begin(names, format)}>开始录制</button>
      </div>
    </div>
  );
}
