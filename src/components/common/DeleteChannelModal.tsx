import { Modal } from './Modal';
import { Button } from './Button';
import type { Channel } from '../../../ipc-contract';

interface DeleteChannelModalProps {
  channel: Channel | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Pairs with useDeleteChannelFlow — the confirmation dialog itself, shared so its copy can't
 * drift between the sidebar and Settings' channel list. */
export function DeleteChannelModal({ channel, onCancel, onConfirm }: DeleteChannelModalProps) {
  if (!channel) return null;
  return (
    <Modal title={`Delete "${channel.name}"?`} onClose={onCancel}>
      <div className="modal__body">
        This removes the channel, its subchannels, its cached stories, and any bookmarks saved under it.
        This can't be undone.
      </div>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete channel
        </Button>
      </div>
    </Modal>
  );
}
