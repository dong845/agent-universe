// The guided tour (spec 2026-11-05 B1): each step moves the camera to what it explains and highlights it
// (a ring in the scene, a glow on a panel); the card sits beside the highlight, never over the middle of
// the screen. It ends back in space inviting a click on a planet. Skippable, remembered, replayable from
// the settings.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEnter } from "../city/cityReplay.ts";
import { mainRobot } from "../city/Robot.tsx";
import { t, useLang } from "../i18n/index.ts";
import { useStore } from "../store.ts";
import { tourDone, useTour } from "./tourStore.ts";
import { tourSteps, type TourGo } from "./tourSteps.ts";

/** start the tour for this world (on a first visit, or from the settings) */
export function replayTour() {
  const { biggest, hasRobot } = useTour.getState().ctx;
  startTour(biggest, hasRobot);
}

export function startTour(biggest: string | null, hasRobot: boolean) {
  const source = useStore.getState().source;
  useTour.getState().start(tourSteps({ source, biggest, hasRobot }));
}

function carryOut(go: TourGo, key: string | null) {
  const st = useStore.getState();
  if (go === "overview" || go === "leave") {
    st.setFollowAgent(null);
    if (st.city) st.setCity(null);
    st.select(null);
    st.setFocus(null);
  } else if (go === "focus" && key) {
    if (st.city) st.setCity(null);
    st.setFocus(key);
  } else if (go === "enter" && key) {
    st.setFollowAgent(null);
    if (st.city !== key) {
      st.setFocus(key);
      useEnter.getState().request(key);
    }
  } else if (go === "follow") {
    // the robots appear once the city has loaded: try for a while
    let n = 0;
    const tryFollow = () => {
      const id = mainRobot();
      if (id) useStore.getState().setFollowAgent(id);
      else if (n++ < 40 && useTour.getState().steps[useTour.getState().step]?.go === "follow") setTimeout(tryFollow, 250);
    };
    tryFollow();
  } else if (go === "stay") st.setFollowAgent(null);
}

const CARD_W = 300;
/** beside the anchor, on its side away from the middle of the screen when that fits */
function place(a: { x: number; y: number; r?: number }, w: number, h: number) {
  const gap = Math.max(70, (a.r ?? 0) + 24);
  const left = a.x - gap - CARD_W, right = a.x + gap;
  const fitsLeft = left >= 10, fitsRight = right + CARD_W <= w - 10;
  const x = a.x < w / 2 ? (fitsLeft ? left : right) : (fitsRight ? right : left);
  return { left: Math.max(10, Math.min(x, w - CARD_W - 10)), top: Math.max(70, Math.min(a.y - 70, h - 280)) };
}

export function Tour({ biggest, hasRobot }: { biggest: string | null; hasRobot: boolean }) {
  useLang();
  const step = useTour((s) => s.step);
  const steps = useTour((s) => s.steps);
  const anchor = useTour((s) => s.anchor);
  const s = step >= 0 ? steps[step] : undefined;
  useEffect(() => useTour.setState({ ctx: { biggest, hasRobot } }), [biggest, hasRobot]);
  // a first visit starts it
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!tourDone()) startTour(biggest, hasRobot);
  }, [biggest, hasRobot]);
  // each step goes where it explains
  useEffect(() => {
    if (!s) return;
    carryOut(s.go, s.highlight?.kind === "planet" ? s.highlight.key : biggest);
  }, [s, biggest]);
  // a panel the step points at glows; the card goes beside it
  const [dom, setDom] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (s?.highlight?.kind !== "dom") return setDom(null);
    const ids = s.highlight.testid.split("|");
    let el: Element | null = null;
    const find = () => {
      el?.classList.remove("tour-glow");
      el = ids.map((id) => document.querySelector(`[data-testid="${id}"]`)).find(Boolean) ?? null;
      el?.classList.add("tour-glow");
      setDom(el ? el.getBoundingClientRect() : null);
    };
    find();
    const h = setInterval(find, 400);
    return () => { clearInterval(h); el?.classList.remove("tour-glow"); };
  }, [s]);
  if (!s) return null;
  const W = typeof window === "undefined" ? 1440 : window.innerWidth, H = typeof window === "undefined" ? 900 : window.innerHeight;
  const at = dom ? { x: dom.left < W / 2 ? dom.right : dom.left, y: dom.top + 70 } : s.highlight && s.highlight.kind !== "dom" ? anchor : null;
  const style = at ? place(at, W, H) : undefined;
  const last = step === steps.length - 1;
  return (
    <div className="g-tour" data-testid="tour" data-step={s.id} role="dialog" aria-label={t(s.title)} style={style}>
      <small>{step + 1} / {steps.length}</small>
      <b>{t(s.title)}</b>
      <p>{t(s.text)}</p>
      <div>
        <button onClick={() => useTour.getState().end(false)} data-testid="tour-skip">{t("tour.skip")}</button>
        {step > 0 ? <button onClick={() => useTour.getState().go(step - 1)}>{t("tour.prev")}</button> : null}
        {last
          ? <button className="primary" onClick={() => useTour.getState().end(true)} data-testid="tour-done">{t("tour.start")}</button>
          : <button className="primary" onClick={() => useTour.getState().go(step + 1)} data-testid="tour-next">{t("tour.next")}</button>}
      </div>
    </div>
  );
}
