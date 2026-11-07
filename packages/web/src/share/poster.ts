// The review poster (spec 2026-11-05 C3): a 1080×1350 picture of a period — a shot of the universe behind,
// the numbers, a day heatmap, the busiest project, the kinds of work, the subagents used, the character's
// face. Everything it writes goes through `text`, which returns the list (the privacy test reads it):
// project names come from `names` (the export switch), never a title, gist, path or session id.
import { formatCount } from "../../../schema/src/aggregate.ts";
import { WORK_COLOR } from "../galaxy/galaxyData.ts";
import { tl, type Key, type Lang } from "../i18n/index.ts";
import type { Period, ReviewStats } from "./review.ts";

export const POSTER = { w: 1080, h: 1350 };
/** 35,810,700,000 → 35.8B: short enough for a tile */

const FONT = `-apple-system, "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", system-ui, sans-serif`;

export function drawPoster(ctx: CanvasRenderingContext2D, s: ReviewStats, o: { bg: CanvasImageSource | null; face: CanvasImageSource | null; lang: Lang; period: Period; names: (key: string) => string }): string[] {
  const { w: W, h: H } = POSTER;
  const drawn: string[] = [];
  const L = (k: Key, v?: Record<string, string | number>) => tl(o.lang, k, v);
  const text = (t: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = "left", spacing = 0) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    if (spacing) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
    ctx.fillText(t, x, y);
    if (spacing) (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
    drawn.push(t);
  };
  const round = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  };

  // the background: the universe as it is on screen, dimmed towards the bottom for the text
  ctx.fillStyle = "#070b16";
  ctx.fillRect(0, 0, W, H);
  if (o.bg) {
    const bw = (o.bg as { width: number }).width, bh = (o.bg as { height: number }).height;
    const k = Math.max(W / bw, H / bh);
    ctx.drawImage(o.bg, (W - bw * k) / 2, (H - bh * k) / 2, bw * k, bh * k);
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(6, 9, 18, 0.45)");
  g.addColorStop(0.35, "rgba(6, 9, 18, 0.78)");
  g.addColorStop(1, "rgba(6, 9, 18, 0.94)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // header
  text("AGENT UNIVERSE", 72, 104, 26, "#ffd58a", 700, "left", 6);
  text(L(`poster.${o.period}` as Key), 72, 190, 76, "#ffffff", 800);
  text(`${s.from} → ${s.to}`, 72, 238, 28, "#9fb0cc");
  if (o.face) ctx.drawImage(o.face, W - 72 - 170, 64, 170, 170);

  // the three numbers
  const tiles: [string, Key][] = [[s.requests.toLocaleString("en-US"), "poster.requests"], [s.products.toLocaleString("en-US"), "poster.products"], [formatCount(s.tokens, o.lang), "poster.tokens"]];
  const tw = (W - 144 - 2 * 24) / 3;
  tiles.forEach(([v, k], i) => {
    const x = 72 + i * (tw + 24);
    round(x, 290, tw, 170, 22, "rgba(255, 255, 255, 0.07)");
    // the biggest size that fits the tile
    let size = 68;
    ctx.font = `800 ${size}px ${FONT}`;
    while (size > 30 && ctx.measureText(v).width > tw - 56) ctx.font = `800 ${(size -= 4)}px ${FONT}`;
    text(v, x + 28, 390, size, "#ffffff", 800);
    text(L(k), x + 28, 432, 26, "#9fb0cc");
  });

  // the days
  let y = 530;
  text(L("poster.streak", { n: s.streak }), 72, y, 30, "#ffd58a", 700);
  y += 30;
  const max = Math.max(1, ...s.days.map((d) => d.n));
  const cell = (n: number) => (n ? `rgba(255, 170, 80, ${0.25 + 0.75 * (n / max)})` : "rgba(255, 255, 255, 0.07)");
  if (s.days.length <= 31) {
    // a bar per day
    const bw = (W - 144) / s.days.length;
    const top = y + 10, hgt = 170;
    s.days.forEach((d, i) => {
      const h = d.n ? Math.max(8, (d.n / max) * hgt) : 6;
      round(72 + i * bw + bw * 0.12, top + hgt - h, bw * 0.76, h, Math.min(8, bw * 0.3), cell(d.n));
    });
    y = top + hgt + 20;
  } else {
    // a week per column, Monday on top; the last 53 weeks at most
    const days = s.days.slice(-371);
    const first = new Date(`${days[0].day}T00:00:00Z`).getUTCDay();
    const offset = (first + 6) % 7;
    const cols = Math.ceil((days.length + offset) / 7);
    const c = Math.min(26, (W - 144) / cols - 3);
    days.forEach((d, i) => {
      const k = i + offset;
      round(72 + Math.floor(k / 7) * (c + 3), y + 10 + (k % 7) * (c + 3), c, c, 3, cell(d.n));
    });
    y += 10 + 7 * (c + 3) + 10;
  }

  // the busiest project
  y += 50;
  if (s.busiest) {
    text(L("poster.busiest"), 72, y, 26, "#9fb0cc");
    text(o.names(s.busiest.key), 72, y + 58, 50, "#ffffff", 800);
    text(L("poster.busiestN", { n: s.busiest.n }), W - 72, y + 58, 28, "#9fb0cc", 400, "right");
    y += 100;
  } else {
    text(L("poster.quiet"), 72, y + 20, 34, "#9fb0cc", 600);
    y += 60;
  }

  // the kinds of work
  if (s.work.length) {
    y += 30;
    text(L("poster.work"), 72, y, 26, "#9fb0cc");
    const wmax = s.work[0].n;
    // the label column is as wide as the widest label (D26 A3); labels shrink so bars keep 40 % of the width
    const labels = s.work.map((wk) => L(`work.${wk.role}` as Key));
    let size = 28;
    const widest = () => {
      ctx.font = `600 ${size}px ${FONT}`;
      return Math.max(...labels.map((l) => ctx.measureText(l).width));
    };
    while (size > 18 && widest() > (W - 144) * 0.4) size -= 2;
    const barX = 72 + widest() + 24;
    const barRoom = W - 72 - 130 - barX;
    s.work.forEach((wk, i) => {
      const yy = y + 26 + i * 52;
      const bar = (barRoom * wk.n) / wmax;
      round(barX, yy, Math.max(10, bar), 30, 10, WORK_COLOR[wk.role] ?? "#888");
      text(labels[i], 72, yy + 25, size, "#e6eefc", 600);
      text(wk.n.toLocaleString("en-US"), W - 72, yy + 25, 26, "#9fb0cc", 400, "right");
    });
    y += 26 + s.work.length * 52;
  }

  // the subagents
  if (s.spawns) {
    y += 46;
    const types = s.subagents.length ? `  ·  ${s.subagents.map((a) => `${a.type} ×${a.n}`).join("  ·  ")}` : "";
    text(`${L("poster.subagents", { n: s.spawns.toLocaleString("en-US") })}${types}`, 72, y, 26, "#c7d4ea");
  }

  text(L("poster.footer"), W / 2, H - 48, 22, "rgba(200, 212, 234, 0.6)", 400, "center");
  return drawn;
}
