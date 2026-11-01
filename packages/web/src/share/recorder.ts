// Recording the scene the owner is watching (spec 2026-11-01 C). Each frame, right after the scene is
// drawn, the WebGL picture and the visible labels (planet and town names, building tags, robot bubbles,
// which are HTML over the canvas) are painted into one 2D canvas, which MediaRecorder turns into a video.
// GIF: every third frame at half size, encoded in the page (gifenc).
import { useFrame, useThree } from "@react-three/fiber";
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { useEffect } from "react";
import { create } from "zustand";
import { pickMime } from "./recordFormat.ts";

/** the HTML labels a recording carries */
export const LABEL_SELECTOR = ".g-planet, .g-star, .g-tag, .g-street, .g-bubble";
export const MAX_RECORD_MS = 60_000;

const transparent = (c: string) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);

/** paints every visible label under `root` into ctx; `origin` is the canvas's page rect, `scale` CSS px → canvas px */
export function drawLabels(ctx: CanvasRenderingContext2D, root: ParentNode, origin: DOMRect, scale: number): number {
  let drawn = 0;
  const range = document.createRange();
  for (const el of root.querySelectorAll<HTMLElement>(LABEL_SELECTOR)) {
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.right < origin.left || r.left > origin.right || r.bottom < origin.top || r.top > origin.bottom) continue;
    const X = (x: number) => (x - origin.left) * scale;
    const Y = (y: number) => (y - origin.top) * scale;
    ctx.save();
    ctx.globalAlpha = Number(cs.opacity) || 1;
    if (!transparent(cs.backgroundColor)) {
      ctx.beginPath();
      ctx.roundRect(X(r.left), Y(r.top), r.width * scale, r.height * scale, (parseFloat(cs.borderTopLeftRadius) || 0) * scale);
      ctx.fillStyle = cs.backgroundColor;
      ctx.fill();
      const bw = parseFloat(cs.borderTopWidth) || 0;
      if (bw && !transparent(cs.borderTopColor)) {
        ctx.lineWidth = bw * scale;
        ctx.strokeStyle = cs.borderTopColor;
        ctx.stroke();
      }
    }
    // the badges: their SVG paths, scaled from the viewBox into the badge's box
    for (const svg of el.querySelectorAll("svg")) {
      const b = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      if (!b.width || !vb?.width) continue;
      ctx.save();
      ctx.translate(X(b.left), Y(b.top));
      ctx.scale((b.width * scale) / vb.width, (b.height * scale) / vb.height);
      ctx.translate(-vb.x, -vb.y);
      ctx.fillStyle = getComputedStyle(svg).color;
      for (const p of svg.querySelectorAll("path")) ctx.fill(new Path2D(p.getAttribute("d") ?? ""), (p.getAttribute("fill-rule") as CanvasFillRule) ?? "nonzero");
      ctx.restore();
    }
    // the text, run by run, in each run's own font and colour, with a shadow for the dark sky
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      if (!text.trim() || !n.parentElement) continue;
      range.selectNodeContents(n);
      const tr = range.getBoundingClientRect();
      if (!tr.width) continue;
      const ps = getComputedStyle(n.parentElement);
      ctx.font = `${ps.fontStyle} ${ps.fontWeight} ${parseFloat(ps.fontSize) * scale}px ${ps.fontFamily}`;
      ctx.letterSpacing = `${(parseFloat(ps.letterSpacing) || 0) * scale}px`;
      ctx.fillStyle = ps.color;
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 3 * scale;
      ctx.fillText(text.trim(), X(tr.left), Y(tr.top + tr.height / 2));
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    drawn++;
  }
  return drawn;
}

interface Session {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  started: number;
  frame: number;
  format: "mp4" | "gif";
  rec?: MediaRecorder;
  chunks: Blob[];
  ext: string;
  gif?: ReturnType<typeof GIFEncoder>;
  gifCanvas?: HTMLCanvasElement;
  lastGif: number;
}

interface RecState {
  session: Session | null;
  /** labels drawn into the last frame (test hook) */
  lastLabels: number;
  start(gl: HTMLCanvasElement, format: "mp4" | "gif"): void;
  /** ends the recording and hands back the file */
  stop(): Promise<{ blob: Blob; ext: string } | null>;
}

/** test hook: labels painted into the last recorded frame */
(globalThis as unknown as { __recLabels?: () => number }).__recLabels = () => useRecorder.getState().lastLabels;

export const useRecorder = create<RecState>((set, get) => ({
  session: null,
  lastLabels: 0,
  start(gl, format) {
    if (get().session) return;
    const canvas = document.createElement("canvas");
    canvas.width = gl.width;
    canvas.height = gl.height;
    const ctx = canvas.getContext("2d")!;
    const s: Session = { canvas, ctx, started: performance.now(), frame: 0, format, chunks: [], ext: format, lastGif: 0 };
    if (format === "mp4") {
      const { mime, ext } = pickMime((m) => MediaRecorder.isTypeSupported(m));
      s.ext = ext;
      s.rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      s.rec.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
      s.rec.start(500);
    } else {
      s.gif = GIFEncoder();
      s.gifCanvas = document.createElement("canvas");
      s.gifCanvas.width = Math.round(gl.width / 2);
      s.gifCanvas.height = Math.round(gl.height / 2);
    }
    set({ session: s });
  },
  async stop() {
    const s = get().session;
    if (!s) return null;
    set({ session: null });
    if (s.rec) {
      const done = new Promise<void>((res) => (s.rec!.onstop = () => res()));
      s.rec.stop();
      await done;
      return { blob: new Blob(s.chunks, { type: s.rec.mimeType }), ext: s.ext };
    }
    s.gif!.finish();
    return { blob: new Blob([s.gif!.bytes() as BlobPart], { type: "image/gif" }), ext: "gif" };
  },
}));

/** mounted inside the Canvas: paints each finished frame while a recording runs */
export function RecordCompositor() {
  const { gl } = useThree();
  // priority 2: after the effect composer (priority 1) has drawn this frame, before the browser clears it
  useFrame(() => {
    const s = useRecorder.getState().session;
    if (!s) return;
    const src = gl.domElement;
    const { ctx, canvas } = s;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const origin = src.getBoundingClientRect();
    const n = drawLabels(ctx, document, origin, canvas.width / origin.width);
    ctx.save();
    ctx.font = `600 ${Math.round(canvas.height * 0.018)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("Agent Town", canvas.width - canvas.height * 0.02, canvas.height * 0.98);
    ctx.restore();
    useRecorder.setState({ lastLabels: n });
    s.frame++;
    if (s.gif && s.gifCanvas && performance.now() - s.lastGif >= 100) {
      s.lastGif = performance.now();
      const g = s.gifCanvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(canvas, 0, 0, s.gifCanvas.width, s.gifCanvas.height);
      const { data, width, height } = g.getImageData(0, 0, s.gifCanvas.width, s.gifCanvas.height);
      const palette = quantize(data, 256);
      s.gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: 100 });
    }
  }, 2);
  useEffect(() => () => void useRecorder.getState().stop(), []);
  return null;
}
