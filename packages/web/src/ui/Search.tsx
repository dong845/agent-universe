// Find a project by name (spec 2026-11-05 B3): `/` or a click puts the cursor here; the list matches as
// you type; Enter (or a click) flies to the planet, Enter again on the same planet enters its city.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Faction } from "../../../schema/src/event.ts";
import { useEnter } from "../city/cityReplay.ts";
import { searchTowns } from "../galaxy/search.ts";
import { t, useLang } from "../i18n/index.ts";
import { useStore } from "../store.ts";

export interface SearchTown { key: string; name: string; faction: Faction; badge: React.ReactNode; hidden?: boolean }

export function Search({ towns }: { towns: SearchTown[] }) {
  useLang();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchTowns(towns, q), [towns, q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = (key: string) => {
    const st = useStore.getState();
    // a town the owner hid has no planet to fly to: straight into its city (D27 A3)
    if (st.focus === key || towns.find((x) => x.key === key)?.hidden) {
      // already there: into the city, as a click on the planet does
      st.select({ kind: "town", district: key });
      useEnter.getState().request(key);
      setQ("");
      input.current?.blur();
    } else st.setFocus(key);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && hits[sel]) { e.preventDefault(); go(hits[sel].key); }
    else if (e.key === "Escape") { setQ(""); input.current?.blur(); }
    e.stopPropagation();
  };
  return (
    <div className="g-search" data-testid="search-box">
      <input
        ref={input}
        value={q}
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={onKeyDown}
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        data-testid="search"
        spellCheck={false}
      />
      {hits.length ? (
        <ul role="listbox">
          {hits.map((h, i) => (
            <li key={h.key} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} data-testid="search-hit" onMouseDown={(e) => { e.preventDefault(); setSel(i); go(h.key); }}>
              {h.badge}{h.name}{h.hidden ? <small className="g-search-tag">{t("town.hiddenTag")}</small> : null}
            </li>
          ))}
        </ul>
      ) : q.trim() ? <ul><li className="none">{t("search.none")}</li></ul> : null}
    </div>
  );
}
