import { groupByDay } from '../../utils/groupByDay';
import { formatDateHeader } from '../../services/formatters';
import { NewsCard, type NewsCardData } from './NewsCard';
import type { ViewMode } from '../../../ipc-contract';
import './NewsFeed.css';

interface NewsFeedProps {
  articles: NewsCardData[];
  channelId: string;
  viewMode: ViewMode;
  maxPerDay?: number;
}

export function NewsFeed({ articles, channelId, viewMode, maxPerDay = 20 }: NewsFeedProps) {
  const byDay = groupByDay(articles, 'publishedAt', maxPerDay);
  const containerClass = viewMode === 'grid' ? 'news-feed__grid' : 'news-feed__list';

  return (
    <div className="news-feed">
      {[...byDay.entries()].map(([dateKey, dayArticles]) => (
        <section key={dateKey}>
          <div className="news-feed__day-header">{formatDateHeader(dayArticles[0].publishedAt)}</div>
          <div className={containerClass}>
            {dayArticles.map((article) => (
              <NewsCard key={article.id} article={article} channelId={channelId} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
