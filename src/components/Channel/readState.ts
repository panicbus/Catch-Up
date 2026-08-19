/** Pure, plain-data selector logic pulled out of NewsFeed.tsx specifically so it's reachable by the
 * test suite (no DOM, no React) — see vitest.config.ts's src/ include and this module's own
 * .test.ts. Both functions here encode a correctness property that a live screen recording caught
 * regressed in practice; the tests exist to keep that from happening silently a second time. */

/** A card the app already knows is read — either the server has confirmed it
 * (`serverConfirmedRead`, NewsFeed's own `isRead(a)`, which already folds in the locallyUnread
 * override) or it was marked read in place THIS session via passive scroll/open/checkmark and the
 * server just hasn't caught up yet (`keepVisible.has(id)`). That confirmation can lag up to ~20
 * seconds behind (see api.ts's poll interval) — gating display purely on `serverConfirmedRead` is
 * what made reads look slow and arrive in big delayed batches instead of individually.
 *
 * Used for DISPLAY and SELECTION — "is this card read for the purposes of what shows/dims/counts" —
 * everywhere in NewsFeed.tsx except two places that specifically need the raw, server-confirmed
 * value instead: the archive partition (which uses `keepVisible` membership to mean the OPPOSITE,
 * "not yet filed away"), and the locallyUnread-pruning effect (which is specifically watching for the
 * real value to catch up). See NewsFeed.tsx's own comments at each of those two call sites. */
export function isEffectivelyRead(serverConfirmedRead: boolean, id: string, keepVisible: ReadonlySet<string>): boolean {
  return serverConfirmedRead || keepVisible.has(id);
}

/** A stable signature of a set of unread ids — order-independent (sorted before joining), so a
 * same-membership reorder (e.g. a relevance-mode poll reshuffling ranks with no actual read-state
 * change) doesn't register as a change. Consumed by useScrollCatchUp as `unreadKey`: a real change
 * here is what tells it which cards to start or stop watching, so a spurious change from reordering
 * alone means unnecessary reconciliation work for no reason. */
export function buildUnreadKey(unreadIds: Iterable<string>): string {
  return [...unreadIds].sort().join('|');
}
