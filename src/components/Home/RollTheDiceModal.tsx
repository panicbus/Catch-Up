import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { NewsCard } from '../Channel/NewsCard';
import { Button } from '../common/Button';
import { api } from '../../services/api';
import { useChannels } from '../../hooks/useChannels';
import type { Article } from '../../../ipc-contract';
import './RollTheDiceModal.css';

interface RollTheDiceModalProps {
  onClose: () => void;
}

/** undefined = loading, null = nothing unread anywhere */
type ShuffleState = Article | null | undefined;

export function RollTheDiceModal({ onClose }: RollTheDiceModalProps) {
  const { channels } = useChannels();
  const [article, setArticle] = useState<ShuffleState>(undefined);
  const [renderKey, setRenderKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const channelName = article ? channels.find((c) => c.id === article.channelId)?.name : undefined;

  const shuffle = useCallback((excludeArticleId?: string) => {
    setArticle(undefined);
    setExpanded(false);
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
    // Keyed so the whole dialog box remounts (and replays its modal--flip entrance) on every roll,
    // not just the first open — a plain re-render wouldn't retrigger the CSS animation.
    <Modal
      key={renderKey}
      title="Roll the dice"
      hideTitle
      onClose={onClose}
      contentClassName="modal--flip roll-the-dice-modal"
    >
      {article === undefined ? (
        <div className="roll-the-dice-modal__loading">Shuffling…</div>
      ) : article === null ? (
        <div className="roll-the-dice-modal__empty">No unread stories anywhere right now. Check back later.</div>
      ) : (
        // Keyed to force a fresh mount per shuffle, resetting NewsCard's local expand/exit state.
        <div className="roll-the-dice-modal__card" key={renderKey}>
          {channelName && <div className="roll-the-dice-modal__channel">{channelName}</div>}
          <NewsCard
            article={article}
            hideDismiss
            hideNewBadge
            expanded={expanded}
            onToggleExpand={() => setExpanded((v) => !v)}
            onBookmarkToggled={(bookmarked) => setArticle((prev) => (prev ? { ...prev, bookmarked } : prev))}
          />
        </div>
      )}
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={() => shuffle(article?.id)}>
          Roll again
        </Button>
      </div>
    </Modal>
  );
}
