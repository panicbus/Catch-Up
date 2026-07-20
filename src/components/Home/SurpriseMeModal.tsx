import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { NewsCard } from '../Channel/NewsCard';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import type { Article } from '../../../ipc-contract';
import './SurpriseMeModal.css';

interface SurpriseMeModalProps {
  onClose: () => void;
}

/** undefined = loading, null = nothing unread anywhere */
type ShuffleState = Article | null | undefined;

export function SurpriseMeModal({ onClose }: SurpriseMeModalProps) {
  const [article, setArticle] = useState<ShuffleState>(undefined);
  const [renderKey, setRenderKey] = useState(0);

  const shuffle = useCallback((excludeArticleId?: string) => {
    setArticle(undefined);
    void api.getRandomArticle(excludeArticleId).then((next) => {
      setArticle(next);
      setRenderKey((k) => k + 1);
    });
  }, []);

  useEffect(() => {
    shuffle();
    // Only on mount — "Shuffle again" drives subsequent fetches explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Surprise me" onClose={onClose} contentClassName="modal--flip surprise-modal">
      {article === undefined ? (
        <div className="surprise-modal__loading">Shuffling…</div>
      ) : article === null ? (
        <div className="surprise-modal__empty">No unread stories anywhere right now — check back later.</div>
      ) : (
        // Keyed to force a fresh mount per shuffle, resetting NewsCard's local expand/exit state.
        <div className="surprise-modal__card" key={renderKey}>
          <NewsCard
            article={article}
            channelId={article.channelId}
            hideDismiss
            onBookmarkToggled={(bookmarked) => setArticle((prev) => (prev ? { ...prev, bookmarked } : prev))}
          />
        </div>
      )}
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={() => shuffle(article?.id)}>
          Shuffle again
        </Button>
      </div>
    </Modal>
  );
}
