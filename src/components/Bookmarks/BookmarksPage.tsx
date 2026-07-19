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

  const tabs = useMemo(
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

  const currentChannelId = activeChannelId ?? tabs[0]?.channelId ?? null;
  const currentBookmarks = currentChannelId ? byChannel[currentChannelId] ?? [] : [];

  const articles: NewsCardData[] = currentBookmarks.map((bookmark) => ({
    id: bookmark.articleId,
    url: bookmark.articleSnapshot.url,
    title: bookmark.articleSnapshot.title,
    snippet: bookmark.articleSnapshot.snippet,
    source: bookmark.articleSnapshot.source,
    publishedAt: bookmark.articleSnapshot.publishedAt,
    paywalled: bookmark.articleSnapshot.paywalled,
    bookmarked: true,
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
          <BookmarksChannelTabs tabs={tabs} activeChannelId={currentChannelId} onSelect={setActiveChannelId} />
          <NewsFeed articles={articles} channelId={currentChannelId!} viewMode={settings.defaultViewMode} />
        </>
      )}
    </div>
  );
}
