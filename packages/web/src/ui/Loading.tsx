// The screen before the world: reading progress, or what to do when the local server is not running.
import type { Progress } from "../data.ts";
import { t } from "../i18n/index.ts";

export function Loading({ p }: { p: Progress | null }) {
  return (
    <div className="loading" data-testid="loading">
      {p?.phase === "error" ? (
        <>
          <b>{p.message}</b>
          <span>{t("load.devHint")}</span>
        </>
      ) : (
        <>
          <b>{t("load.reading")} {p ? `${p.done}/${p.total}` : ""}</b>
          <span>{t("load.slowFirst")}</span>
        </>
      )}
    </div>
  );
}
