import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookmarks } from '../../hooks/useBookmarks';
import { useChannels } from '../../hooks/useChannels';
import { useSettings } from '../../hooks/useSettings';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BookmarksChannelTabs } from './BookmarksChannelTabs';
import { ViewModeToggle } from '../Channel/ViewModeToggle';
import { NewsFeed } from '../Channel/NewsFeed';
import { EmptyState } from '../common/EmptyState';
import type { NewsCardData } from '../Channel/NewsCard';
import './BookmarksPage.css';

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function BookmarksPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { byChannel } = useBookmarks();
  const { channels } = useChannels();
  const { settings, update } = useSettings();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  const channelTabs = useMemo(
    () =>
      Object.entries(byChannel)
        .filter(([, bookmarks]) => bookmarks.length > 0)
        .map(([channelId, bookmarks]) => ({
          channelId,
          name: channels.find((c) => c.id === channelId)?.name ?? 'Unknown channel',
          count: bookmarks.length,
        })),
    [byChannel, channels]
  );

  // "All" is its own tab (channelId: null) rather than just a default state, so switching between
  // one channel's bookmarks and every channel's is an explicit, always-available choice — not
  // something you can only get back to by never having clicked a channel tab in the first place.
  const tabs = useMemo(() => {
    if (channelTabs.length === 0) return [];
    const total = channelTabs.reduce((sum, t) => sum + t.count, 0);
    return [{ channelId: null, name: 'All', count: total }, ...channelTabs];
  }, [channelTabs]);

  // null means "All" — both the initial default and what clicking the All tab sets it back to.
  const currentBookmarks = activeChannelId ? byChannel[activeChannelId] ?? [] : Object.values(byChannel).flat();

  const articles: NewsCardData[] = currentBookmarks.map((bookmark) => ({
    id: bookmark.articleId,
    url: bookmark.articleSnapshot.url,
    title: bookmark.articleSnapshot.title,
    snippet: bookmark.articleSnapshot.snippet,
    imageUrl: bookmark.articleSnapshot.imageUrl,
    source: bookmark.articleSnapshot.source,
    publishedAt: bookmark.articleSnapshot.publishedAt,
    paywalled: bookmark.articleSnapshot.paywalled,
    bookmarked: true,
    read: bookmark.read,
    channelId: bookmark.channelId,
    channelName: channels.find((c) => c.id === bookmark.channelId)?.name ?? 'Unknown channel',
  }));

  return (
    <div className="bookmarks-page">
      <div className="bookmarks-page__sticky">
        <div className="bookmarks-page__header">
          {isMobile && (
            <button type="button" className="bookmarks-page__back" onClick={() => navigate('/')} aria-label="Back to Home">
              <BackIcon />
            </button>
          )}
          <h1 className="bookmarks-page__title">Bookmarks</h1>
          {/* A grid view makes no sense at phone width — hidden rather than shown-disabled, since
              there's nothing to toggle to (matches ChannelPage's identical reasoning). */}
          {tabs.length > 0 && !isMobile && (
            <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
          )}
        </div>
        {tabs.length > 0 && (
          <BookmarksChannelTabs tabs={tabs} activeChannelId={activeChannelId} onSelect={setActiveChannelId} />
        )}
      </div>

      {tabs.length === 0 ? (
        <EmptyState title="No bookmarks yet" body="Tap the bookmark icon on any story to save it here." />
      ) : (
        <>
          <NewsFeed
            articles={articles}
            channelName={activeChannelId ? channels.find((c) => c.id === activeChannelId)?.name ?? '' : 'Bookmarks'}
            viewMode={isMobile ? 'list' : settings.defaultViewMode}
            partitionByRead={false}
          />
        </>
      )}
    </div>
  );
}
