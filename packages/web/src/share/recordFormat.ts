// What a recording is saved as (spec 2026-11-01 C).

/** MP4 (H.264) where the browser records it (Chrome does), else WebM */
export function pickMime(isSupported: (m: string) => boolean): { mime: string; ext: "mp4" | "webm" } {
  for (const [mime, ext] of [["video/mp4;codecs=avc1", "mp4"], ["video/mp4", "mp4"], ["video/webm;codecs=vp9", "webm"], ["video/webm;codecs=vp8", "webm"], ["video/webm", "webm"]] as const) {
    if (isSupported(mime)) return { mime, ext };
  }
  throw new Error("这个浏览器不能录视频（不支持 MediaRecorder 的 MP4 或 WebM）");
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fileName(town: string, d: Date, ext: string): string {
  const safe = town.replace(/[^\p{L}\p{N}._·-]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `agent-town-${safe}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`;
}
