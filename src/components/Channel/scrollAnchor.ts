/** Pure decision logic for NewsFeed's scroll-position compensation — see NewsFeed.tsx's own comments
 * at its render-time vanished-id check and the layout effect that consumes this for the full picture
 * of why a total-scrollHeight delta (the previous approach) was wrong: it doesn't know WHERE in the
 * viewport a removal happened, so it "corrected" scrollTop by the full size of anything that vanished
 * even when that content was below the fold and the browser had moved nothing. Anchoring to one real,
 * still-present element's own on-screen position sidesteps that — it's correct by construction
 * regardless of where the removal happened, exactly like the browser's own (native, but WebKit/iOS
 * Safari-unsupported) `overflow-anchor` behavior. */

export interface AnchorCandidate {
  id: string;
  /** viewport-relative, from getBoundingClientRect() */
  top: number;
  /** viewport-relative, from getBoundingClientRect() */
  bottom: number;
}

/** Picks the first candidate, in document/visual order, that is both (a) not one of the ids about to
 * disappear and (b) at least partially at or below the visible area's top edge (`visibleTop`) — i.e.
 * the first card whose current on-screen position is still a meaningful thing to anchor to. Skipping
 * vanishing ids during selection (rather than picking one and discovering afterward that it's going
 * away) means there's never a need for a fallback re-pick once the removal actually lands.
 *
 * Returns null when nothing survives (e.g. every currently-visible card is about to disappear at
 * once, such as tapping "Archive read" while the whole visible screenful is read-in-place) — the
 * caller should accept the resulting jump rather than falling back to the provably-wrong
 * total-height delta this replaced. */
export function pickSurvivingAnchor(
  candidates: AnchorCandidate[],
  visibleTop: number,
  vanishingIds: ReadonlySet<string>
): AnchorCandidate | null {
  for (const c of candidates) {
    if (vanishingIds.has(c.id)) continue;
    if (c.bottom > visibleTop) return c;
  }
  return null;
}
