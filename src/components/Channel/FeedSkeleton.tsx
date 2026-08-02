import './FeedSkeleton.css';

/** Placeholder for the moment between "we know this channel exists" and "we have its articles" —
 * fills the same gap that used to render nothing (a stale-but-harmless previous channel's articles)
 * or, worse, a real NewsFeed with zero articles, which read as a false "All caught up!" for however
 * long the fetch took. Three cards, no attempt to guess real content — just enough shape that the
 * page doesn't read as empty or broken while genuinely waiting on the network. */
export function FeedSkeleton() {
  return (
    <div className="feed-skeleton" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="feed-skeleton__card" key={i}>
          <div className="feed-skeleton__line feed-skeleton__line--title" />
          <div className="feed-skeleton__line feed-skeleton__line--body" />
          <div className="feed-skeleton__line feed-skeleton__line--meta" />
        </div>
      ))}
    </div>
  );
}

/** The whole-page version — for the narrower gap before the CHANNEL itself (not just its articles)
 * is known, e.g. a cold load of a direct channel URL before the channel list has arrived. Distinct
 * from a "channel not found" state, which this is deliberately never shown alongside. */
export function ChannelPageSkeleton() {
  return (
    <div className="feed-skeleton-page" aria-hidden="true">
      <div className="feed-skeleton__line feed-skeleton-page__heading" />
      <FeedSkeleton />
    </div>
  );
}
