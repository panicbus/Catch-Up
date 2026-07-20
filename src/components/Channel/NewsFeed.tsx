import { useEffect, useRef, useState } from 'react';
import { groupByDay } from '../../utils/groupByDay';
import { formatDateHeader } from '../../services/formatters';
import { NewsCard, type NewsCardData } from './NewsCard';
import { AllCaughtUp } from './AllCaughtUp';
import type { ViewMode } from '../../../ipc-contract';
import './NewsFeed.css';

/** Must match main/dataStore.ts's READ_STATE_MAX_AGE_DAYS — that's what actually stops collecting
 * read stories past this point; this is just the label saying so. */
const READ_ARCHIVE_DAYS = 30;

interface NewsFeedProps {
  articles: NewsCardData[];
  channelId: string;
  channelName: string;
  viewMode: ViewMode;
  maxPerDay?: number;
  /** Partition into unread/read with a per-date "read stories" archive and an "all caught up"
   * celebration when unread hits zero — the inbox-style behavior that fits a channel's news feed.
   * Bookmarks are a saved-for-later list, not an inbox to clear, so BookmarksPage opts out and
   * just shows everything flat regardless of read state. */
  partitionByRead?: boolean;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function DayGroups({
  articles,
  channelId,
  viewMode,
  maxPerDay,
  staysInPlace,
  removeCardOnUnbookmark,
  expandedArticleId,
  onToggleExpand,
}: {
  articles: NewsCardData[];
  channelId: string;
  viewMode: ViewMode;
  maxPerDay: number;
  staysInPlace: boolean;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
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
                expanded={expandedArticleId === article.id}
                onToggleExpand={() => onToggleExpand(article.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ReadArchive({
  articles,
  channelId,
  viewMode,
  removeCardOnUnbookmark,
  expandedArticleId,
  onToggleExpand,
}: {
  articles: NewsCardData[];
  channelId: string;
  viewMode: ViewMode;
  removeCardOnUnbookmark: boolean;
  expandedArticleId: string | null;
  onToggleExpand: (articleId: string) => void;
}) {
  const byDay = groupByDay(articles, 'publishedAt');
  const [openDate, setOpenDate] = useState<string | null>(null);
  const containerClass = viewMode === 'grid' ? 'news-feed__grid' : 'news-feed__list';

  const toggleDate = (dateKey: string) => {
    setOpenDate((prev) => (prev === dateKey ? null : dateKey));
  };

  return (
    <div className="news-feed__archive">
      <div className="news-feed__archive-title">Read stories · {READ_ARCHIVE_DAYS} day archive</div>
      {[...byDay.entries()].map(([dateKey, dayArticles]) => {
        const isOpen = openDate === dateKey;
        return (
          <div key={dateKey} className="news-feed__archive-date">
            <button
              type="button"
              className="news-feed__archive-date-toggle"
              onClick={() => toggleDate(dateKey)}
              aria-expanded={isOpen}
            >
              <ChevronIcon open={isOpen} />
              <span>{formatDateHeader(dayArticles[0].publishedAt)}</span>
              <span className="news-feed__archive-count">{dayArticles.length}</span>
            </button>
            <div className={`news-feed__archive-body ${isOpen ? 'news-feed__archive-body--open' : ''}`}>
              <div className="news-feed__archive-body-inner">
                <div className={`${containerClass} news-feed__archive-cards`}>
                  {dayArticles.map((article) => (
                    <NewsCard
                      key={article.id}
                      article={article}
                      channelId={channelId}
                      staysInPlace
                      removeCardOnUnbookmark={removeCardOnUnbookmark}
                      expanded={expandedArticleId === article.id}
                      onToggleExpand={() => onToggleExpand(article.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
  const [justCleared, setJustCleared] = useState(false);
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  const prevUnreadCountRef = useRef<number | null>(null);

  const unread = partitionByRead ? articles.filter((a) => !a.read) : articles;
  const read = partitionByRead ? articles.filter((a) => a.read) : [];

  const toggleExpand = (articleId: string) =>
    setExpandedArticleId((prev) => (prev === articleId ? null : articleId));

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
          expandedArticleId={expandedArticleId}
          onToggleExpand={toggleExpand}
        />
      )}

      {read.length > 0 && (
        <ReadArchive
          articles={read}
          channelId={channelId}
          viewMode={viewMode}
          removeCardOnUnbookmark={!partitionByRead}
          expandedArticleId={expandedArticleId}
          onToggleExpand={toggleExpand}
        />
      )}
    </div>
  );
}
