import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useChannels } from '../../hooks/useChannels';
import { useChannelArticles } from '../../hooks/useChannelArticles';
import { useSettings } from '../../hooks/useSettings';
import { useTrustedSourceToggle } from '../../hooks/useTrustedSourceToggle';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SubchannelBar } from './SubchannelBar';
import { SubchannelPickerTrigger, SubchannelPickerPanel } from './SubchannelPicker';
import { SubchannelManagePanel } from '../common/SubchannelManagePanel';
import { ViewModeToggle } from './ViewModeToggle';
import { SortModeToggle } from './SortModeToggle';
import { NewsFeed, type NewsFeedHandle } from './NewsFeed';
import { FeedSkeleton, ChannelPageSkeleton } from './FeedSkeleton';
import { EmptyState } from '../common/EmptyState';
import { Button } from '../common/Button';
import { PauseChannelControl, isChannelPaused } from '../common/PauseChannelControl';
import { OverflowMenu } from '../common/OverflowMenu';
import { ChannelPausedScreen } from './ChannelPausedScreen';
import { api, revalidateNow, RateLimitError } from '../../services/api';
import * as channelsStore from '../../services/channelsStore';
import { formatTimeUntil } from '../../services/formatters';
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

/** The sticky bar's echo of the page's own title, once it's scrolled out of view (see ChannelPage's
 * IntersectionObserver effect and ChannelPage.css's own comment on the width-only 0fr/1fr collapse
 * this animates through). Extracted so both the mobile and desktop controls layouts below can render
 * it identically without duplicating the markup. */
function StickyTitleEcho({ visible, name }: { visible: boolean; name: string }) {
  return (
    <span className={`channel-page__sticky-title ${visible ? 'channel-page__sticky-title--visible' : ''}`}>
      <span className="channel-page__sticky-title-inner">{name}</span>
    </span>
  );
}

/** Same reasoning as StickyTitleEcho above — shared between the mobile and desktop controls layouts
 * rather than duplicated. */
function ArchiveReadButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className="channel-page__archive-read"
      disabled={count === 0}
      onClick={onClick}
      title="Move stories you've read (by scrolling past or opening) into the archive"
    >
      <ArchiveIcon />
      Archive read
      {/* Always rendered, even at zero, so the button's width is fixed by the slot rather than by
          whether the count happens to be showing — see .channel-page__archive-read-count's own
          comment for the iOS repaint artifact that a changing width strands behind it. */}
      <span className="channel-page__archive-read-count">{count > 0 ? `(${count})` : ''}</span>
    </button>
  );
}

export function ChannelPage() {
  // The URL identifies a channel by its slug (a readable version of the name, e.g. "tech"), not its
  // real database id — slugs are unique per account (schema's userId+slug constraint), so this is a
  // safe lookup key. Every internal operation below still uses the resolved channel's REAL id
  // (channel.id) — the backend's routes take real ids, not slugs, and nothing about how a channel is
  // actually addressed server-side changed, only what appears in the address bar.
  const { channelSlug } = useParams<{ channelSlug: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { channels, loading: channelsLoading } = useChannels();
  const channel = channels.find((c) => c.slug === channelSlug) ?? null;
  const { settings, update } = useSettings();
  const { trustedSourceDomains, onToggleTrust } = useTrustedSourceToggle(settings, update);
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
  // ChannelPage isn't remounted when only the :channelSlug route param changes (same route
  // element), so this is the one place a still-in-flight refresh can check "is the channel I
  // started against still the one on screen" after an await — without it, navigating away
  // mid-refresh lets a slow response for the OLD channel overwrite the feed and refresh note for
  // whatever channel you've since switched to. Tracks the resolved channel's REAL id (not the slug)
  // since that's what handleRefresh's requestedChannelId comparison is keyed on below.
  const channelIdRef = useRef(channel?.id);
  const [managingSubchannels, setManagingSubchannels] = useState(false);
  const [subchannelPickerOpen, setSubchannelPickerOpen] = useState(false);
  const [titleScrolledOut, setTitleScrolledOut] = useState(false);
  const [readInPlaceCount, setReadInPlaceCount] = useState(0);
  const feedRef = useRef<NewsFeedHandle>(null);
  const clearSuppressRef = useRef(false);
  // A callback ref (rather than useRef + a effect keyed on channelSlug) so the observer attaches
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
    channelIdRef.current = channel?.id;
    setRefreshNote(null);
    setRefreshSlow(false);
    setRefreshing(false);
    clearRefreshTimers();
    // Also keyed on channel?.id, not just channelSlug: on a fresh page load (a bookmark, a browser
    // refresh) the channel list hasn't loaded yet on this effect's first run, so channel is still
    // null and channelIdRef.current would sync to undefined — then never resync, since channelSlug
    // itself doesn't change again once channels finish loading. Without this, refreshing on a
    // freshly-loaded channel page would have channelIdRef.current stuck at undefined forever,
    // making handleRefresh's "did the channel change mid-request" guard always read true and
    // silently discard every refresh result. Harmless to also re-run this on normal in-app
    // navigation (channel?.id changing alongside channelSlug) — there's nothing to reset yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSlug, channel?.id]);

  const { articles, loading, reload, subchannelCounts, totalUnread } = useChannelArticles(
    channel?.id ?? null,
    subchannelId,
    settings.defaultSortMode
  );

  // Switching sort order re-sorts the whole list under you, so staying at whatever offset you
  // happened to be at leaves you mid-way down an order you've never seen. Back to the top instead,
  // which is also the only position that means the same thing in both orders. Skips the initial
  // mount (there's nothing to reset yet, and this would fight a restored position on first paint).
  const prevSortModeRef = useRef(settings.defaultSortMode);
  useEffect(() => {
    if (prevSortModeRef.current === settings.defaultSortMode) return;
    prevSortModeRef.current = settings.defaultSortMode;
    document.querySelector<HTMLElement>('.app-shell__main')?.scrollTo({ top: 0 });
  }, [settings.defaultSortMode]);

  // The sticky controls bar picks up the channel name once the page's own title has scrolled
  // behind it. Plain threshold: 0 against the root's raw bounds, deliberately with no rootMargin
  // offset for the sticky bar's own height — a rootMargin correction was tried here and reverted:
  // the title sits IMMEDIATELY above the sticky bar with no content between them (unlike the
  // article cards further down, which useScrollCatchUp DOES need to offset for), so the title
  // finishes scrolling out of raw view at essentially the same scroll position the sticky bar pins
  // at anyway — there's no real gap to correct for. Offsetting it anyway made titleScrolledOut turn
  // true immediately at rest (before any scrolling at all), which showed the small sticky-bar title
  // and the real page title at the same time and kept re-triggering the reveal transition —
  // confirmed live as exactly that regression.
  //
  // Recomputed from the live scroll position rather than driven by an IntersectionObserver (the
  // original version) or a getBoundingClientRect() comparison run on every scroll tick (the first
  // attempt at this fix, still reported stuck after shipping). Both of those compare two LIVE
  // measurements against each other on every check; this instead measures a single fixed THRESHOLD
  // once — the scrollTop value at which the title's bottom edge reaches the container's own visible
  // top — and then every check is just `scrollRoot.scrollTop >= threshold`, a plain number
  // comparison with nothing left to disagree with itself about. Self-correcting by construction
  // either way (recomputed fresh on every scroll/resize rather than waiting for a delivered "change"
  // event), but with only one measurement in play instead of two, there's less for iOS's own moving
  // parts (the dynamic toolbar resizing the visual viewport mid-scroll) to desynchronize.
  useEffect(() => {
    if (!titleNode) return;
    // AppShell's .app-shell__main div is the actual scroll container (the browser viewport never
    // scrolls in this layout), so the threshold has to be relative to ITS content, not the viewport.
    const scrollRoot = titleNode.closest<HTMLElement>('.app-shell__main');
    if (!scrollRoot) return;

    let threshold = 0;
    const measure = () => {
      // Converts the title's CURRENT viewport-relative position into a scroll-content-relative one
      // (independent of however much is already scrolled), by adding back the current scrollTop.
      const titleBottom = titleNode.getBoundingClientRect().bottom;
      const rootTop = scrollRoot.getBoundingClientRect().top;
      threshold = titleBottom - rootTop + scrollRoot.scrollTop;
    };
    const update = () => setTitleScrolledOut(scrollRoot.scrollTop >= threshold);
    const recompute = () => {
      measure();
      update();
    };
    recompute();

    // Resize covers anything that shifts the title's own position (the header reflowing, a refresh
    // notice appearing above it) without a scroll event of its own to trigger a recheck.
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(titleNode);
    resizeObserver.observe(scrollRoot);
    scrollRoot.addEventListener('scroll', update, { passive: true });
    return () => {
      resizeObserver.disconnect();
      scrollRoot.removeEventListener('scroll', update);
    };
  }, [titleNode, channelSlug]);

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
    let result;
    try {
      result = await api.refreshChannel(requestedChannelId);
    } catch (e) {
      // The only case refreshChannel can actually throw rather than come back with `errors`
      // populated: a guest account out of daily refreshes (server/stores/providerBudget.ts) — the
      // API answers with a 429 before running any provider search at all, which api.ts's request()
      // surfaces as a RateLimitError instead of a normal result. The owner's account is never
      // capped, so this path never applies to it.
      if (refreshSlowTimerRef.current) clearTimeout(refreshSlowTimerRef.current);
      if (channelIdRef.current === requestedChannelId) {
        setRefreshSlow(false);
        setRefreshing(false);
        setRefreshNote(
          e instanceof RateLimitError
            ? `Daily refresh limit reached — resets in ${formatTimeUntil(e.resetsAt ?? '')}.`
            : 'Refresh failed — try again.'
        );
        noteTimerRef.current = setTimeout(() => {
          if (channelIdRef.current === requestedChannelId) setRefreshNote(null);
        }, 4000);
      }
      return;
    }
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
            {/* Icon-only read as "what does a circular arrow even mean" (confirmed live) — desktop's
                equivalent Button always pairs the icon with the word "Refresh"; this mirrors that
                instead of leaving mobile as the one place the icon has to speak for itself. */}
            <button
              type="button"
              className="channel-page__refresh-mobile"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshIcon spinning={refreshing} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
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
          {isMobile ? (
            // Own layout, not a squeezed/wrapped version of desktop's: the title shares a row with
            // the sort toggle (which is ALWAYS present, so that row's height never depends on
            // whether the title happens to be showing — see ChannelPage.css's own comment on why
            // the previous height-toggling version of the title caused the feed below to visibly
            // drop by ~10px the moment it appeared), and Archive read gets its own row underneath.
            // SubchannelBar is desktop-only chrome anyway (hidden by its own CSS on mobile even when
            // rendered), so it's simply not rendered here rather than mounted and immediately hidden.
            <>
              <div className="channel-page__controls-row1">
                <StickyTitleEcho visible={titleScrolledOut} name={channel.name} />
                <SortModeToggle value={settings.defaultSortMode} onChange={(mode) => update({ defaultSortMode: mode })} />
              </div>
              <ArchiveReadButton count={readInPlaceCount} onClick={() => feedRef.current?.flushReadInPlace()} />
            </>
          ) : (
            <>
              <div className="channel-page__controls-left">
                <StickyTitleEcho visible={titleScrolledOut} name={channel.name} />
                <SubchannelBar
                  subchannels={channel.subchannels}
                  activeId={subchannelId}
                  onSelect={setSubchannelId}
                  managing={managingSubchannels}
                  onManageClick={() => setManagingSubchannels((v) => !v)}
                  counts={subchannelCounts}
                  totalUnread={totalUnread}
                />
              </div>
              <div className="channel-page__controls-right">
                <ArchiveReadButton count={readInPlaceCount} onClick={() => feedRef.current?.flushReadInPlace()} />
                <SortModeToggle value={settings.defaultSortMode} onChange={(mode) => update({ defaultSortMode: mode })} />
                <ViewModeToggle value={settings.defaultViewMode} onChange={(mode) => update({ defaultViewMode: mode })} />
              </div>
            </>
          )}
        </div>

        {/* Its own full-width row below the title/archive row, not squeezed in beside them — sharing
            that row with the sticky-title echo meant a long channel name (e.g. "Unemployment") left
            this pill almost no width, wrapping its label onto two lines and visually colliding with
            Archive read next to it. Desktop's pill row (SubchannelBar's chips, hidden on mobile —
            see its CSS) uses flex-wrap, which stacks badly at phone width; this trigger + the panel
            below are the mobile stand-in, sharing the exact same counts/selection state.
            SubchannelBar's manage toggle (the "+Add subchannels" / "Manage subchannels" pill) stays
            visible on both. */}
        {isMobile && (
          <div className="channel-page__subchannel-row">
            <SubchannelPickerTrigger
              subchannels={channel.subchannels}
              open={subchannelPickerOpen}
              onToggle={() => setSubchannelPickerOpen((v) => !v)}
              onManageClick={() => setManagingSubchannels((v) => !v)}
            />
          </div>
        )}

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
          body={
            <>
              Catch Up checks for new stories every 30 minutes.
              <br />
              Hit Refresh to check now.
            </>
          }
          action={
            activeSubchannel ? (
              <button type="button" className="empty-state__action" onClick={() => setSubchannelId(null)}>
                ← Back to {channel.name}
              </button>
            ) : (
              <button type="button" className="empty-state__action" onClick={() => navigate('/')}>
                ← Back to home
              </button>
            )
          }
        />
      ) : (
        <NewsFeed
          // Remounts on a sort change, which resets NewsFeed's own per-visit local state in one
          // move: the pinned set (which ids stay in the main list), the read-in-place set behind the
          // "Archive read" count, and the previous-order snapshot driving scroll compensation. All
          // three are scoped to "this ordering of this list" and none of them survive a re-sort
          // meaningfully — the two orders put a DIFFERENT set of stories inside the display cap, so
          // carrying them across accumulated the union of both and left the Archive-read count
          // reporting on stories the current order wasn't even showing. Remounting rather than
          // resetting each by hand so a future piece of per-visit state can't be forgotten here.
          // Also stops the scroll compensation from firing on a re-sort, which it otherwise treats
          // as a reorder to be counteracted — exactly backwards when the reorder is the thing the
          // user just asked for.
          key={settings.defaultSortMode}
          ref={feedRef}
          articles={articles.map((a) => ({ ...a, channelName: channel.name }))}
          channelName={caughtUpName}
          viewMode={isMobile ? 'list' : settings.defaultViewMode}
          maxUnreadStories={settings.maxStoriesShown}
          onReadInPlaceCountChange={setReadInPlaceCount}
          suppressCelebrationRef={clearSuppressRef}
          parentChannelName={activeSubchannel ? channel.name : undefined}
          onBackToParent={activeSubchannel ? () => setSubchannelId(null) : undefined}
          trustedSourceDomains={trustedSourceDomains}
          onToggleTrust={onToggleTrust}
          sortMode={settings.defaultSortMode}
        />
      )}
    </div>
  );
}
