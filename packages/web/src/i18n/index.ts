// The interface language (spec 2026-11-05 D): Chinese or English. It follows the browser until the user
// picks one in the settings (remembered in this browser). `t` reads the current language; components
// that show text subscribe with useLang so a switch re-renders them.
import { create } from "zustand";
import { en } from "./en.ts";
import { zh, type Key } from "./zh.ts";
import { formatCount } from "../../../schema/src/aggregate.ts";

export type Lang = "zh" | "en";
export type { Key };
const KEY = "agent-universe:lang";
const DICT: Record<Lang, Record<Key, string>> = { zh, en };

/** the first browser language decides: zh* → Chinese, anything else (or nothing) → English */
export function detectLang(langs: readonly string[]): Lang {
  return langs[0]?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // storage blocked or absent (tests, the share page in a strict browser)
  }
  // outside a browser (unit tests, scripts) the page's original language
  return typeof window === "undefined" ? "zh" : detectLang(navigator.languages ?? [navigator.language]);
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: initial() }));
if (typeof document !== "undefined") document.documentElement.lang = useLang.getState().lang === "zh" ? "zh-CN" : "en";

export function setLang(l: Lang) {
  useLang.setState({ lang: l });
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // not remembered; the choice still holds for this visit
  }
  if (typeof document !== "undefined") document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
}

/** the text for a key in a given language, with {name} placeholders filled */
export function tl(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const s = DICT[lang][key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** a count in the page's language: 36.8B / 368.1亿 (D27 B1) */
export const count = (n: number): string => formatCount(n, useLang.getState().lang);

/** the text for a key in the current language */
export const t = (key: Key, vars?: Record<string, string | number>): string => tl(useLang.getState().lang, key, vars);
