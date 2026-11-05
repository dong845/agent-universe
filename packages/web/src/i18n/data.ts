// Words that arrive inside the data (spec 2026-11-05 D): the server names the capital and the field camp
// towns, skill guilds ("<skill> 公会") and continued requests ("接续：…") in Chinese, and the themes and
// roles carry Chinese names. The page words them in its own language here; Chinese passes through.
import themes from "../../../../config/themes.json" with { type: "json" };
import type { Role } from "../../../schema/src/event.ts";
import type { RequestRow, WorldPayload } from "../../../schema/src/payload.ts";
import type { TownRow } from "../../../schema/src/towns.ts";
import { t, tl, useLang, type Key } from "./index.ts";

// the server's Chinese words, read from the Chinese dictionary so they live in one place
const GUILD = tl("zh", "town.guild", { name: "" });
const CONTINUES = tl("zh", "worldgen.continues", { title: "" });

/** a town's name in the page's language */
export function townName(town: Pick<TownRow, "kind" | "name">): string {
  if (useLang.getState().lang === "zh") return town.name;
  if (town.kind === "capital" && town.name === themes.fixed.capital.name) return t("kind.capital");
  if (town.kind === "outpost" && town.name === themes.fixed.outpost.name) return t("kind.outpost");
  if (town.kind === "guild" && town.name.endsWith(GUILD)) return t("town.guild", { name: town.name.slice(0, -GUILD.length) });
  return town.name;
}

/** a request title in the page's language ("接续：x" → "Continues: x") */
export function titleText(title: string | undefined): string | undefined {
  if (!title || useLang.getState().lang === "zh" || !title.startsWith(CONTINUES)) return title;
  return t("worldgen.continues", { title: title.slice(CONTINUES.length) });
}

/** the payload with its towns and titles worded in the page's language (unchanged in Chinese) */
export function localizePayload(p: WorldPayload): WorldPayload {
  if (useLang.getState().lang === "zh") return p;
  const towns = p.towns.map((tw) => ({
    ...tw,
    name: townName(tw),
    ...(tw.skillNote && tw.kind === "guild" ? { skillNote: t("town.guild", { name: tw.guildOf.join(", ") }) } : {}),
  }));
  const requests = p.requests.map((r): RequestRow => (r.title?.startsWith(CONTINUES) ? { ...r, title: titleText(r.title) } : r));
  return { ...p, towns, requests };
}

const THEME_KEY: Record<string, Key> = {
  publishing: "theme.publishing", film: "theme.film", music: "theme.music", talent: "theme.talent", harbor: "theme.harbor",
  stargazer: "theme.stargazer", exchange: "theme.exchange", toyworks: "theme.toyworks", craftsmen: "theme.craftsmen",
  capital: "kind.capital", outpost: "kind.outpost",
};
/** a theme's name: from config/themes.json in Chinese, from the dictionary otherwise */
export function themeName(id: string): string {
  if (useLang.getState().lang !== "zh" && THEME_KEY[id]) return t(THEME_KEY[id]);
  const all = [...themes.themes, themes.default, themes.fixed.capital, themes.fixed.outpost];
  return all.find((x) => x.id === id)?.name ?? id;
}

/** a role's name (the timeline's roles: commander, scout, …) */
export const roleName = (r: Role): string => t(`role.${r}` as Key);
