// A shared page's replays (spec 2026-11-01 D): the requests the owner chose to send along, each
// playable in its city. (The diary, the usual way in, stays closed in a shared world.)
import { useReplay } from "../city/cityReplay.ts";
import { cityPlaces } from "../city/cityData.ts";
import { useStore } from "../store.ts";
import { embeddedWorld } from "./embedded.ts";
import { t } from "../i18n/index.ts";

export function ShareReplays() {
  const w = useStore((s) => s.w25);
  const city = useStore((s) => s.city);
  const playing = useReplay((s) => s.r?.requestId);
  const list = embeddedWorld()?.shareReplays ?? [];
  if (!list.length || !w) return null;
  return (
    <div className="g-share-replays" data-testid="share-replays">
      <header>{t("share.replays")}</header>
      {list.map((rp) => {
        const r = w.requests.get(rp.requestId);
        if (!r) return null;
        const key = `${r.faction}|${r.projectId}`;
        const town = w.towns.get(key);
        return (
          <button key={rp.requestId} className={playing === rp.requestId ? "on" : ""} onClick={() => {
            const layout = w.layouts.get(key);
            if (!layout || !rp.events.length) return;
            useReplay.getState().start(key, rp.requestId, r.title ?? "", rp.events, cityPlaces(layout, rp.requestId));
            if (city !== key) useStore.getState().setCity(key);
          }}>
            ▶ {town?.name ?? ""} · {r.title}
          </button>
        );
      })}
    </div>
  );
}
