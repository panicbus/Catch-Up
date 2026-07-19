export function groupByDay<T, F extends keyof T>(
  items: T[],
  field: F,
  maxPerDay = Infinity
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const iso = item[field] as unknown as string;
    const key = new Date(iso).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key)!;
    if (arr.length < maxPerDay) arr.push(item);
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
