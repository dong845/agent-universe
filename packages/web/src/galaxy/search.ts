// Find a project by name (spec 2026-11-05 B3): names that start with the query first, then names with a
// word that does (after - _ . / | or a space), then any name that contains it; case does not matter.
export function searchTowns<T extends { key: string; name: string }>(towns: readonly T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (name: string) => {
    const n = name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (new RegExp(`[\\s\\-_./|]${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n)) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return towns
    .map((t, i) => ({ t, i, r: rank(t.name) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.t.name.length - b.t.name.length || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.t);
}
