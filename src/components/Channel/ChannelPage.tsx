import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useChannels } from '../../hooks/useChannels';
import { useChannelArticles } from '../../hooks/useChannelArticles';
import { useSettings } from '../../hooks/useSettings';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SubchannelBar } from './SubchannelBar';
import { SubchannelPickerTrigger, SubchannelPickerPanel } from './SubchannelPicker';
import { SubchannelManagePanel } from '../common/SubchannelManagePanel';
import { ViewModeToggle } from './ViewModeToggle';
import { NewsFeed, type NewsFeedHandle } from './NewsFeed';
import { FeedSkeleton, ChannelPageSkeleton } from './FeedSkeleton';
import { EmptyState } from '../common/EmptyState';
import { Button } from '../common/Button';
import { PauseChannelControl, isChannelPaused } from '../common/PauseChannelControl';
import { OverflowMenu } from '../common/OverflowMenu';
import { ChannelPausedScreen } from './ChannelPausedScreen';
import { api, revalidateNow } from '../../services/api';
import * as channelsStore from '../../services/channelsStore';
import './ChannelPage.css';

function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
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
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { channels, loading: channelsLoading } = useChannels();
  const { settings, update } = useSettings();
  const [subchannelId, setSubchannelId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only shown once a refresh has been running for a while (see handleRefresh) — most refreshes
  // finish quickly, and showing this immediately every time would make a fast, normal refresh
  // read as if something might be wrong.
  const [refreshSlow, setRefreshSlow] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const refreshSlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Separate from refreshSlowTimerRef: that one ARMS the "still checking" message after a delay;
  // this one DISMISSES the terminal result message after it's had time to be read. Two different
  // timers because the two messages have different lifecycles — see handleRefresh below.
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ChannelPage isn't remounted when only the :channelId route param changes (same route element),
  // so this is the one place a still-in-flight refresh can check "is the channel I started against
  // still the one on screen" after an await — without it, navigating away mid-refresh lets a slow
  // response for the OLD channel overwrite the feed and refresh note for whatever channel you've
  // since switched to.
  const channelIdRef = useRef(channelId);
  const [managingSubchannels, setManagingSubchannels] = useState(false);
  const [subchannelPickerOpen, setSubchannelPickerOpen] = useState(false);
  const [titleScrolledOut, setTitleScrolledOut] = useState(false);
  const [readInPlaceCount, setReadInPlaceCount] = useState(0);
  const feedRef = useRef<NewsFeedHandle>(null);
  const clearSuppressRef = useRef(false);
  // A callback ref (rather than useRef + a effect keyed on channelId) so the observer attaches
  // exactly when the <h1> node actually mounts — channels load asynchronously via IPC, so on first
  // render `channel` is still null and the early `if (!channel) return null` below skips rendering
  // the title entirely; a plain useRef effect would run once against that null ref and never retry.
  const [titleNode, setTitleNode] = useState<HTMLHeadingElement | null>(null);

  // Both refresh timers, cleared together — wired into every site that needs to invalidate one or
  // both, so the two can't drift (e.g. one site remembering to clear refreshSlowTimerRef but not
  // the newer noteTimerRef).
  const clearRefreshTimers = () => {
    if (refreshSlowTimerRef.current) clearTimeout(refreshSlowTimerRef.current);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    refreshSlowTimerRef.current = null;
    noteTimerRef.current = null;
  };

  // Navigating away mid-refresh must not fire a delayed message (or any state update) against
  // an unmounted component.
  useEffect(() => {
    return () => clearRefreshTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching channels reuses this same component instance, so refresh UI left over from the
  // previous channel (a note, a spinner, a pending timer of either kind) has to be cleared
  // explicitly here — otherwise it just sits there describing a channel you're no longer on. This
  // is a correctness requirement, not hygiene: without it, switching to a new channel and refreshing
  // it within 4s would let the OLD channel's dismiss timer clear the NEW channel's note early.
  useEffect(() => {
    channelIdRef.current = channelId;
    setRefreshNote(null);
    setRefreshSlow(false);
    setRefreshing(false);
    clearRefreshTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const channel = channels.find((c) => c.id === channelId) ?? null;
  const { articles, loading, reload, subchannelCounts, totalUnread } = useChannelArticles(
    channelId ?? null,
    subchannelId
  );

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

  if (!channel) {
    // Two genuinely different states used to look identical (a blank page): the channel list just
    // hasn't loaded yet (cold load of a direct channel URL, or a not-yet-warm store), vs. this id
    // doesn't correspond to any real channel (stale link, a channel deleted from another tab/device).
    // Only the first is transient — the second would otherwise leave a permanently blank page.
    return (
      <div className="channel-page">
        {channelsLoading ? (
          <ChannelPageSkeleton />
        ) : (
          <EmptyState title="Channel not found" body="This channel may have been deleted." />
        )}
      </div>
    );
  }

  const handleRefresh = async () => {
    const requestedChannelId = channel.id;
    setRefreshing(true);
    setRefreshNote(null);
    setRefreshSlow(false);
    // A second overlapping click shouldn't inherit the previous click's pending dismiss — e.g.
    // click Refresh, get a result at 4s, click Refresh again at 2s: without this the FIRST result's
    // dismiss timer would still fire at the 4s mark and clear whatever note the SECOND click sets.
    clearRefreshTimers();
    // A real refresh checks the topic AND every one of its subchannels, each against several news
    // sources in turn — genuinely a few seconds at best, longer with more subchannels, and longer
    // still if the free-tier server has gone to sleep and needs to wake up first. Rather than
    // pretend that's instant, only say something once it's actually taking a while — 2.5s is
    // roughly "longer than a normal refresh," so quick refreshes stay quiet.
    refreshSlowTimerRef.current = setTimeout(() => {
      if (channelIdRef.current === requestedChannelId) setRefreshSlow(true);
    }, 2500);
    const result = await api.refreshChannel(requestedChannelId);
    if (refreshSlowTimerRef.current) clearTimeout(refreshSlowTimerRef.current);
    // Navigated to a different channel while this was in flight — its result no longer belongs on
    // screen. The channel-change effect above already reset refreshing/refreshSlow/refreshNote and
    // whatever's now visible has its own reload wired up, so there's nothing left to do here.
    if (channelIdRef.current !== requestedChannelId) return;
    setRefreshSlow(false);
    setRefreshing(false);
    // Belt-and-suspenders: the main process also broadcasts a 'articles' event on a successful
    // refresh, which useChannelArticles is already subscribed to — but explicitly reloading here means
    // the list shown can never disagree with the "Found N stories" note above it regardless of
    // whether that broadcast fires, arrives, or is still in flight by the time this resolves.
    reload();

    // Provider rate-limit state is deliberately NOT surfaced here — it's noise in this message, and
    // the same status already shows in Settings › News providers (the colored dots).
    if (result.errors.length > 0) {
      setRefreshNote(`Refresh hit an error: ${result.errors[0]}`);
    } else if (result.added === 0) {
      setRefreshNote(`No new stories about ${channel.name} from your news sources. Catch Up pulls automatically every 30 min.`);
    } else {
      setRefreshNote(`Found ${result.added} new stor${result.added === 1 ? 'y' : 'ies'}.`);
    }
    // Unlike "Checking multiple sources…" (a live status tied to the refresh actually being in
    // flight), this is a terminal result — it doesn't need to keep meaning anything once it's had
    // time to be read. The channelIdRef guard mirrors the one above; the channel-change effect
    // already clears this on a switch, but a stale timer landing on the wrong channel would be a
    // silent, hard-to-notice bug, and the guard costs nothing.
    noteTimerRef.current = setTimeout(() => {
      if (channelIdRef.current === requestedChannelId) setRefreshNote(null);
    }, 4000);
  };

  // Manual "clear" (mark all read). Arm the suppress ref first so NewsFeed treats the resulting
  // 0-unread as a manual clear — no celebration, no streak advance.
  const handleClear = () => {
    if (totalUnread === 0) return;
    clearSuppressRef.current = true;
    void api.clearChannel(channel.id);
    revalidateNow();
  };

  // The "All caught up in X!" message should name whatever you're actually viewing — the channel
  // AND the active subchannel when one is selected (matching the header's own "Tech · Jobs"), not
  // just the subchannel alone, which read as if the channel itself had been dropped.
  const activeSubchannel = subchannelId ? channel.subchannels.find((s) => s.id === subchannelId) : null;
  const caughtUpName = activeSubchannel ? `${channel.name} · ${activeSubchannel.name}` : channel.name;

  // While paused, the channel view is replaced by a grayed "on a break" takeover — only Resume acts.
  if (isChannelPaused(channel.pausedUntil)) {
    return (
      <div className="channel-page">
        <ChannelPausedScreen
          name={channel.name}
          pausedUntil={channel.pausedUntil}
          onResume={() => {
            const id = channel.id;
            channelsStore
              .mutate(
                (prev) => prev.map((c) => (c.id === id ? { ...c, pausedUntil: null, pausedLabel: null } : c)),
                () => api.setChannelPause(id, null)
              )
              .then(() => revalidateNow())
              .catch(() => {});
          }}
        />
      </div>
    );
  }

  return (
    <div className="channel-page">
      {isMobile ? (
        // Structurally different enough from the desktop header (a back button in place of the
        // sidebar's implicit "away from this page", icon-only actions instead of labelled buttons,
        // Pause/Clear folded into one menu) that branching the whole row reads clearer than
        // threading conditionals through a single shared block.
        <div className="channel-page__header channel-page__header--mobile">
          <button type="button" className="channel-page__icon-btn" onClick={() => navigate(-1)} aria-label="Back">
            <BackIcon />
          </button>
          <h1 className="channel-page__title channel-page__title--mobile" ref={setTitleNode}>
            {channel.name}
            {/* Which subchannel you're actually looking at otherwise had no on-screen indication
                once the picker itself closed back up — the list below looks identical to "All"
                until you scroll back up to the (closed) trigger to check. */}
            {activeSubchannel && <span className="channel-page__title-sub"> · {activeSubchannel.name}</span>}
          </h1>
          <div className="channel-page__header-actions">
            <button
              type="button"
              className="channel-page__icon-btn"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label={refreshing ? 'Refreshing' : 'Refresh'}
            >
              <RefreshIcon spinning={refreshing} />
            </button>
            <OverflowMenu channelId={channel.id} onMarkAllRead={handleClear} markAllReadDisabled={totalUnread === 0} />
          </div>
        </div>
      ) : (
        <div className="channel-page__header">
          <h1 className="channel-page__title" ref={setTitleNode}>{channel.name}</h1>
          <div className="channel-page__header-actions">
            <PauseChannelControl channelId={channel.id} pausedUntil={channel.pausedUntil} />
            <Button variant="secondary" size="sm" onClick={handleClear} disabled={totalUnread === 0} title="Mark all stories read">
              <ClearIcon />
              Clear
            </Button>
            <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshIcon spinning={refreshing} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>
      )}

      {/* One shared eyebrow slot for both refresh states — "still checking" while in flight, then
          whatever the result was once it resolves — so the message never jumps position or style
          between the two. */}
      {(refreshSlow || refreshNote) && (
        <p className="channel-page__refresh-status" role="status">
          {refreshSlow ? 'Checking multiple news sources, this can take a little while.' : refreshNote}
        </p>
      )}

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
              counts={subchannelCounts}
              totalUnread={totalUnread}
            />
            {/* Desktop's pill row (SubchannelBar's chips, hidden on mobile — see its CSS) uses
                flex-wrap, which stacks badly at phone width. This trigger + the full-width panel
                below are the mobile stand-in, sharing the exact same counts/selection state;
                SubchannelBar's manage toggle (the "+Add subchannels" / "Manage subchannels" pill)
                stays visible on both. */}
            {isMobile && (
              <SubchannelPickerTrigger
                subchannels={channel.subchannels}
                open={subchannelPickerOpen}
                onToggle={() => setSubchannelPickerOpen((v) => !v)}
                onManageClick={() => setManagingSubchannels((v) => !v)}
              />
            )}
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
            {/* A grid view makes no sense at phone width — hidden rather than shown-disabled, since
                there's nothing to toggle to. Forces the rendered feed to list mode below WITHOUT
                writing to settings.defaultViewMode, which desktop shares. */}
            {!isMobile && (
              <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
            )}
          </div>
        </div>

        {isMobile && (
          <SubchannelPickerPanel
            subchannels={channel.subchannels}
            open={subchannelPickerOpen}
            activeId={subchannelId}
            onSelect={setSubchannelId}
            onClose={() => setSubchannelPickerOpen(false)}
            counts={subchannelCounts}
            totalUnread={totalUnread}
            onManageClick={() => setManagingSubchannels((v) => !v)}
          />
        )}

        {managingSubchannels && (
          <SubchannelManagePanel channel={channel} onClose={() => setManagingSubchannels(false)} />
        )}
      </div>

      {loading && articles.length === 0 ? (
        // Genuinely still waiting on the network for THIS channel's articles — not "loading" in the
        // looser sense useChannelArticles used to use it, which also covered routine background
        // revalidation of data already on screen (see its own loading-gate fix). Without this branch,
        // this exact state fell through to NewsFeed with an empty array, which read as "All caught
        // up!" for however long the fetch took — a real, if brief, false claim on every fresh load.
        <FeedSkeleton />
      ) : articles.length === 0 ? (
        <EmptyState
          title="No stories yet"
          body="Catch Up checks for new stories every 30 minutes. Hit Refresh to check now."
        />
      ) : (
        <NewsFeed
          ref={feedRef}
          articles={articles.map((a) => ({ ...a, channelName: channel.name }))}
          channelName={caughtUpName}
          viewMode={isMobile ? 'list' : settings.defaultViewMode}
          maxUnreadStories={settings.maxStoriesShown}
          onReadInPlaceCountChange={setReadInPlaceCount}
          suppressCelebrationRef={clearSuppressRef}
          parentChannelName={activeSubchannel ? channel.name : undefined}
          onBackToParent={activeSubchannel ? () => setSubchannelId(null) : undefined}
        />
      )}
    </div>
  );
}
