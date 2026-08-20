/** Local (not UTC) calendar-date string, e.g. "2026-07-19" — bucketing must match the day the
 * user actually sees in the (also local-time) section header (formatDateHeader), or two articles
 * on the same local day but on opposite sides of UTC midnight land in different buckets that both
 * render the same-looking header text, reading as a duplicated day. */
function localDateString(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Groups by a DERIVED date rather than a plain field — for callers whose date isn't simply sitting
 * on the item, or (the reason this exists) isn't always populated. NewsFeed's read archive groups by
 * when a story was read, which the server fills in asynchronously: a story archived locally is in
 * the archive a poll cycle before its readAt exists, and `new Date(null)` is the Unix epoch, so
 * without a resolved fallback those stories all bucket into a phantom 1969/1970 group at the very
 * bottom of the archive. A selector lets the caller supply a sensible substitute without cloning
 * every item just to patch one field (which would defeat NewsCard's identity-based memoization). */
export function groupByDayWith<T>(items: T[], selectIso: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = localDateString(selectIso(item));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(selectIso(b)).getTime() - new Date(selectIso(a)).getTime());
  }
  return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

export function groupByDay<T, F extends keyof T>(items: T[], field: F): Map<string, T[]> {
  return groupByDayWith(items, (item) => item[field] as unknown as string);
}
