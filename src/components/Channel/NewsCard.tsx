import { NewBadge } from './NewBadge';
import { PaywallBadge } from './PaywallBadge';
import { BookmarkButton } from '../common/BookmarkButton';
import { relativeTime } from '../../services/formatters';
import './NewsCard.css';

export interface NewsCardData {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
  source: string;
  publishedAt: string;
  paywalled: boolean;
  bookmarked: boolean;
}

interface NewsCardProps {
  article: NewsCardData;
  channelId: string;
}

export function NewsCard({ article, channelId }: NewsCardProps) {
  return (
    <a className="news-card" href={article.url} target="_blank" rel="noopener noreferrer">
      <div className="news-card__bookmark-slot">
        <BookmarkButton articleId={article.id} channelId={channelId} bookmarked={article.bookmarked} />
      </div>
      <div className="news-card__top">
        <NewBadge publishedAt={article.publishedAt} />
        <span className="news-card__title">{article.title}</span>
      </div>
      {article.snippet && <div className="news-card__snippet">{article.snippet}</div>}
      <div className="news-card__footer">
        <PaywallBadge paywalled={article.paywalled} />
        {' '}{article.source} · {relativeTime(article.publishedAt)}
      </div>
    </a>
  );
}
