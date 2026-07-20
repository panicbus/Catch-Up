import { useEffect, useRef, useState } from 'react';
import { groupByDay } from '../../utils/groupByDay';
import { formatDateHeader } from '../../services/formatters';
import { NewsCard, type NewsCardData } from './NewsCard';
import { AllCaughtUp } from './AllCaughtUp';
import type { ViewMode } from '../../../ipc-contract';
import './NewsFeed.css';

interface NewsFeedProps {
  articles: NewsCardData[];
  channelId: string;
  channelName: string;
  viewMode: ViewMode;
  maxPerDay?: number;
  /** Partition into unread/read with a "Show N read stories" toggle and an "all caught up"
   * celebration when unread hits zero — the inbox-style behavior that fits a channel's news feed.
   * Bookmarks are a saved-for-later list, not an inbox to clear, so BookmarksPage opts out and
   * just shows everything flat regardless of read state. */
  partitionByRead?: boolean;
}

function DayGroups({
  articles,
  channelId,
  viewMode,
  maxPerDay,
  staysInPlace,
  removeCardOnUnbookmark,
}: {
  articles: NewsCardData[];
  channelId: string;
  viewMode: ViewMode;
  maxPerDay: number;
  staysInPlace: boolean;
  removeCardOnUnbookmark: boolean;
}) {
  const byDay = groupByDay(articles, 'publishedAt', maxPerDay);
  const containerClass = viewMode === 'grid' ? 'news-feed__grid' : 'news-feed__list';

  return (
    <>
      {[...byDay.entries()].map(([dateKey, dayArticles]) => (
        <section key={dateKey}>
          <div className="news-feed__day-header">{formatDateHeader(dayArticles[0].publishedAt)}</div>
          <div className={containerClass}>
            {dayArticles.map((article) => (
              <NewsCard
                key={article.id}
                article={article}
                channelId={channelId}
                staysInPlace={staysInPlace}
                removeCardOnUnbookmark={removeCardOnUnbookmark}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function NewsFeed({
  articles,
  channelId,
  channelName,
  viewMode,
  maxPerDay = 20,
  partitionByRead = true,
}: NewsFeedProps) {
  const [showRead, setShowRead] = useState(false);
  const [justCleared, setJustCleared] = useState(false);
  const prevUnreadCountRef = useRef<number | null>(null);

  const unread = partitionByRead ? articles.filter((a) => !a.read) : articles;
  const read = partitionByRead ? articles.filter((a) => a.read) : [];

  useEffect(() => {
    if (!partitionByRead) return;
    const prevCount = prevUnreadCountRef.current;
    if (prevCount !== null && prevCount > 0 && unread.length === 0) {
      setJustCleared(true);
    } else if (unread.length > 0) {
      setJustCleared(false);
    }
    prevUnreadCountRef.current = unread.length;
    // Only the unread count should re-run this — article identity churns constantly on refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partitionByRead, unread.length]);

  return (
    <div className="news-feed">
      {partitionByRead && unread.length === 0 ? (
        <AllCaughtUp channelName={channelName} celebrate={justCleared} />
      ) : (
        <DayGroups
          articles={unread}
          channelId={channelId}
          viewMode={viewMode}
          maxPerDay={maxPerDay}
          staysInPlace={!partitionByRead}
          removeCardOnUnbookmark={!partitionByRead}
        />
      )}

      {read.length > 0 && (
        <div className="news-feed__read-section">
          <button type="button" className="news-feed__read-toggle" onClick={() => setShowRead((v) => !v)}>
            {showRead ? 'Hide' : 'Show'} {read.length} read stor{read.length === 1 ? 'y' : 'ies'}
          </button>
          {showRead && (
            <DayGroups
              articles={read}
              channelId={channelId}
              viewMode={viewMode}
              maxPerDay={maxPerDay}
              staysInPlace={!partitionByRead}
              removeCardOnUnbookmark={!partitionByRead}
            />
          )}
        </div>
      )}
    </div>
  );
}
