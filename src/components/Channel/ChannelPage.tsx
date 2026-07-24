import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChannels } from '../../hooks/useChannels';
import { useArticles } from '../../hooks/useArticles';
import { useSettings } from '../../hooks/useSettings';
import { SubchannelBar } from './SubchannelBar';
import { SubchannelManagePanel } from '../common/SubchannelManagePanel';
import { ViewModeToggle } from './ViewModeToggle';
import { NewsFeed, type NewsFeedHandle } from './NewsFeed';
import { EmptyState } from '../common/EmptyState';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import './ChannelPage.css';

function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`channel-page__refresh-icon ${spinning ? 'channel-page__refresh-icon--spinning' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 6a6.5 6.5 0 10.8 4.3" />
      <path d="M16.4 2.6V6H13" />
    </svg>
  );
}

export function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const { channels } = useChannels();
  const { settings, update } = useSettings();
  const [subchannelId, setSubchannelId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [managingSubchannels, setManagingSubchannels] = useState(false);
  const [titleScrolledOut, setTitleScrolledOut] = useState(false);
  const [readInPlaceCount, setReadInPlaceCount] = useState(0);
  const feedRef = useRef<NewsFeedHandle>(null);
  // A callback ref (rather than useRef + a effect keyed on channelId) so the observer attaches
  // exactly when the <h1> node actually mounts — channels load asynchronously via IPC, so on first
  // render `channel` is still null and the early `if (!channel) return null` below skips rendering
  // the title entirely; a plain useRef effect would run once against that null ref and never retry.
  const [titleNode, setTitleNode] = useState<HTMLHeadingElement | null>(null);

  const channel = channels.find((c) => c.id === channelId) ?? null;
  const { articles, loading, reload } = useArticles(channelId ?? null, subchannelId);

  // The sticky controls bar picks up the channel name once the page's own title has scrolled
  // behind it — same threshold, since the sticky bar sits at top: 0, exactly where the title
  // disappears.
  useEffect(() => {
    setTitleScrolledOut(false);
    if (!titleNode) return;
    // Root defaults to the browser viewport, which never scrolls in this layout — AppShell's
    // .app-shell__main div is the actual scroll container, so it must be passed explicitly or the
    // observer never fires.
    const scrollRoot = titleNode.closest<HTMLElement>('.app-shell__main');
    const observer = new IntersectionObserver(([entry]) => setTitleScrolledOut(!entry.isIntersecting), {
      root: scrollRoot,
      threshold: 0,
    });
    observer.observe(titleNode);
    return () => observer.disconnect();
  }, [titleNode, channelId]);

  if (!channel) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshNote(null);
    const result = await api.refreshChannel(channel.id);
    setRefreshing(false);
    // Belt-and-suspenders: the main process also broadcasts a 'articles' event on a successful
    // refresh, which useArticles is already subscribed to — but explicitly reloading here means
    // the list shown can never disagree with the "Found N stories" note above it regardless of
    // whether that broadcast fires, arrives, or is still in flight by the time this resolves.
    reload();

    const rateLimitNote =
      result.rateLimitedProviders.length > 0
        ? ` (${result.rateLimitedProviders.join(', ')} ${result.rateLimitedProviders.length === 1 ? 'is' : 'are'} rate-limited right now — showing results from other sources.)`
        : '';

    if (result.errors.length > 0) {
      setRefreshNote(`Refresh hit an error: ${result.errors[0]}${rateLimitNote}`);
    } else if (result.added === 0) {
      setRefreshNote(`No new stories found.${rateLimitNote}`);
    } else {
      setRefreshNote(`Found ${result.added} new stor${result.added === 1 ? 'y' : 'ies'}.${rateLimitNote}`);
    }
  };

  return (
    <div className="channel-page">
      <div className="channel-page__header">
        <h1 className="channel-page__title" ref={setTitleNode}>{channel.name}</h1>
        <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshIcon spinning={refreshing} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {refreshNote && <p className="channel-page__refresh">{refreshNote}</p>}

      {/* The whole toolbar — controls row plus (when open) the subchannel manage panel — is one
          sticky unit, so the manage panel stays put with the nav instead of scrolling away. Tagged
          data-sticky-nav so useScrollCatchUp can measure its height and offset the scroll-to-read
          trigger below it. */}
      <div className="channel-page__sticky" data-sticky-nav>
        <div className="channel-page__controls">
          <div className="channel-page__controls-left">
            <span
              className={`channel-page__sticky-title ${titleScrolledOut ? 'channel-page__sticky-title--visible' : ''}`}
            >
              <span className="channel-page__sticky-title-inner">{channel.name}</span>
            </span>
            <SubchannelBar
              subchannels={channel.subchannels}
              activeId={subchannelId}
              onSelect={setSubchannelId}
              managing={managingSubchannels}
              onManageClick={() => setManagingSubchannels((v) => !v)}
            />
          </div>
          <div className="channel-page__controls-right">
            <button
              type="button"
              className="channel-page__archive-read"
              disabled={readInPlaceCount === 0}
              onClick={() => feedRef.current?.flushReadInPlace()}
              title="Move stories you've read (by scrolling past or opening) into the archive"
            >
              <ArchiveIcon />
              Archive read{readInPlaceCount > 0 ? ` (${readInPlaceCount})` : ''}
            </button>
            <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
          </div>
        </div>

        {managingSubchannels && (
          <SubchannelManagePanel channel={channel} onClose={() => setManagingSubchannels(false)} />
        )}
      </div>

      {!loading && articles.length === 0 ? (
        <EmptyState
          title="No stories yet"
          body="Catch Up checks for new stories every 30 minutes. Hit Refresh to check now."
        />
      ) : (
        <NewsFeed
          ref={feedRef}
          articles={articles.map((a) => ({ ...a, channelName: channel.name }))}
          channelName={channel.name}
          viewMode={settings.defaultViewMode}
          maxUnreadStories={settings.maxStoriesShown}
          onReadInPlaceCountChange={setReadInPlaceCount}
        />
      )}
    </div>
  );
}
