import { useMemo, useState } from 'react';
import { useBookmarks } from '../../hooks/useBookmarks';
import { useChannels } from '../../hooks/useChannels';
import { useSettings } from '../../hooks/useSettings';
import { BookmarksChannelTabs } from './BookmarksChannelTabs';
import { ViewModeToggle } from '../Channel/ViewModeToggle';
import { NewsFeed } from '../Channel/NewsFeed';
import { EmptyState } from '../common/EmptyState';
import type { NewsCardData } from '../Channel/NewsCard';
import './BookmarksPage.css';

export function BookmarksPage() {
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
      <div className="bookmarks-page__header">
        <h1 className="bookmarks-page__title">Bookmarks</h1>
        {tabs.length > 0 && (
          <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
        )}
      </div>

      {tabs.length === 0 ? (
        <EmptyState title="No bookmarks yet" body="Tap the bookmark icon on any story to save it here." />
      ) : (
        <>
          <BookmarksChannelTabs tabs={tabs} activeChannelId={activeChannelId} onSelect={setActiveChannelId} />
          <NewsFeed
            articles={articles}
            channelName={activeChannelId ? channels.find((c) => c.id === activeChannelId)?.name ?? '' : 'Bookmarks'}
            viewMode={settings.defaultViewMode}
            partitionByRead={false}
          />
        </>
      )}
    </div>
  );
}
