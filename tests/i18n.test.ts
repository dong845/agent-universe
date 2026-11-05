// The interface language (spec 2026-11-05 D): Chinese or English, from the browser or the settings.
import { afterEach, describe, expect, it } from "vitest";
import { detectLang, setLang, t, useLang } from "../packages/web/src/i18n/index.ts";
import { en } from "../packages/web/src/i18n/en.ts";
import { zh } from "../packages/web/src/i18n/zh.ts";

afterEach(() => setLang("zh"));

describe("i18n", () => {
  it("follows the browser: Chinese for zh*, English otherwise", () => {
    expect(detectLang(["zh-CN"])).toBe("zh");
    expect(detectLang(["zh-Hant-TW", "en"])).toBe("zh");
    expect(detectLang(["en-US", "zh"])).toBe("en");
    expect(detectLang(["nl-NL"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });
  it("t fills {placeholders} and switches with the language", () => {
    setLang("zh");
    expect(t("common.calls", { n: 3 })).toBe(zh["common.calls"].replace("{n}", "3"));
    setLang("en");
    expect(t("common.calls", { n: 3 })).toBe(en["common.calls"].replace("{n}", "3"));
    expect(useLang.getState().lang).toBe("en");
  });
  it("a missing variable stays visible rather than vanishing", () => {
    setLang("en");
    expect(t("common.calls")).toContain("{n}");
  });
  it("both dictionaries have the same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe("");
  });
});
