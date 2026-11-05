// Chinese / English (spec 2026-11-05 D): a button in the top-right row. Switching reloads the page, so
// every text built from the data (town names, layouts, cards) comes out in the new language at once; the
// local server is told too, so its notifications and messages match the page.
import { useEffect } from "react";
import { setLang, t, useLang } from "../i18n/index.ts";
import { useStore } from "../store.ts";

const tellServer = (lang: string) =>
  fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang }) }).catch(() => undefined);

export function LangButton() {
  const lang = useLang((s) => s.lang);
  const source = useStore((s) => s.source);
  // the server words notifications in the language this page shows
  useEffect(() => {
    if (source === "real") void tellServer(lang);
  }, [source, lang]);
  const flip = async () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    if (source === "real") await tellServer(next);
    location.reload();
  };
  return <button className="g-export" data-testid="lang" onClick={() => void flip()} title={t("lang.hint")}>{t("lang.switch")}</button>;
}
