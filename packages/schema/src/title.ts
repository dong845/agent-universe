/** Spec 12.5: a task's title is the first non-empty line of its first user message, ≤ 80 characters. */
export const TITLE_MAX = 80;

export function titleOf(text: string): string | undefined {
  const line = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l.length > 0);
  if (!line) return undefined;
  const chars = [...line]; // by code point, so a cut never splits a surrogate pair
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX).join("") + "…" : line;
}
