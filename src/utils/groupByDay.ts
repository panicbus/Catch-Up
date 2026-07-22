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

export function groupByDay<T, F extends keyof T>(items: T[], field: F): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const iso = item[field] as unknown as string;
    const key = localDateString(iso);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  for (const arr of map.values()) {
    arr.sort(
      (a, b) =>
        new Date(b[field] as unknown as string).getTime() -
        new Date(a[field] as unknown as string).getTime()
    );
  }
  return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}
