import './BookmarksChannelTabs.css';

interface BookmarksChannelTabsProps {
  tabs: { channelId: string; name: string; count: number }[];
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
}

export function BookmarksChannelTabs({ tabs, activeChannelId, onSelect }: BookmarksChannelTabsProps) {
  return (
    <div className="bookmarks-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.channelId}
          type="button"
          role="tab"
          aria-selected={activeChannelId === tab.channelId}
          className={`bookmarks-tabs__tab ${activeChannelId === tab.channelId ? 'bookmarks-tabs__tab--active' : ''}`}
          onClick={() => onSelect(tab.channelId)}
        >
          {tab.name} ({tab.count})
        </button>
      ))}
    </div>
  );
}
