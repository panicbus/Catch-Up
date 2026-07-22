/** Rebalances a (typically recency-sorted) list so items with nothing to read in the expanded
 * pane — no snippet, no thumbnail — don't clump into long runs, while otherwise leaving the
 * order untouched. Walks the list in its original order; only when a run of content-less items
 * would exceed `maxConsecutiveEmpty` does it reach further ahead and pull the next upcoming
 * content-having item forward to break up the run. Deliberately not a full content-based
 * re-ranking — this app's feed is chronological by design, this just keeps a source that
 * structurally lacks snippets/images (e.g. Google News RSS, Hacker News) from visually
 * dominating a run of cards. */
export function intersperseByContent<T>(items: T[], hasContent: (item: T) => boolean, maxConsecutiveEmpty = 2): T[] {
  const result: T[] = [];
  const remaining = [...items];
  let emptyRun = 0;

  while (remaining.length > 0) {
    const next = remaining[0];
    if (hasContent(next) || emptyRun < maxConsecutiveEmpty) {
      result.push(remaining.shift()!);
      emptyRun = hasContent(next) ? 0 : emptyRun + 1;
      continue;
    }
    // The run cap would be exceeded by taking `next` as-is — reach ahead for the nearest upcoming
    // content-having item to interrupt the run. If none remain, there's nothing left to break it
    // up with, so just drain the rest in their original order.
    const nextContentIdx = remaining.findIndex(hasContent);
    if (nextContentIdx === -1) {
      result.push(...remaining.splice(0));
      break;
    }
    const [pulled] = remaining.splice(nextContentIdx, 1);
    result.push(pulled);
    emptyRun = 0;
  }

  return result;
}
