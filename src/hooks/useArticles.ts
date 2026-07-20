import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Article } from '../../ipc-contract';

export function useArticles(channelId: string | null, subchannelId: string | null) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!channelId) {
      setArticles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void api.getArticles({ channelId, subchannelId }).then((result) => {
      setArticles(result.articles);
      setLoading(false);
    });
  }, [channelId, subchannelId]);

  useEffect(() => {
    reload();
    return api.onDataChanged((event) => {
      if (event.type === 'articles' && event.channelId === channelId) reload();
      if (event.type === 'bookmarks' && (!event.channelId || event.channelId === channelId)) reload();
      if (event.type === 'readState' && (!event.channelId || event.channelId === channelId)) reload();
    });
  }, [reload, channelId]);

  return { articles, loading, reload };
}
