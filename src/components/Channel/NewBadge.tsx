import { isNewArticle } from '../../utils/isNew';
import './NewBadge.css';

export function NewBadge({ publishedAt }: { publishedAt: string }) {
  if (!isNewArticle(publishedAt)) return null;
  return <span className="new-badge">NEW</span>;
}
