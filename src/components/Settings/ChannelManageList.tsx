import { useState, type KeyboardEvent } from 'react';
import { api } from '../../services/api';
import { useChannels } from '../../hooks/useChannels';
import { SubchannelManagePanel } from '../common/SubchannelManagePanel';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import './ChannelManageList.css';

export function ChannelManageList() {
  const { channels } = useChannels();
  const [draft, setDraft] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const addChannel = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    void api.createChannel(trimmed);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addChannel();
    }
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditValue(name);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      void api.renameChannel(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const pendingDeleteChannel = channels.find((c) => c.id === pendingDeleteId);

  return (
    <div className="channel-manage">
      <div className="channel-manage__add-row">
        <input
          className="channel-manage__input"
          type="text"
          placeholder="Add a new channel — any topic…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Add a channel"
        />
        <Button variant="primary" onClick={addChannel} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      <div className="channel-manage__list">
        {channels.map((channel) => (
          <div key={channel.id}>
            <div className="channel-manage__row">
              {editingId === channel.id ? (
                <input
                  className="channel-manage__row-name-input"
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="channel-manage__row-name" onClick={() => startEdit(channel.id, channel.name)}>
                  {channel.name}
                </span>
              )}
              <span className="channel-manage__row-meta">
                {channel.subchannels.length} subchannel{channel.subchannels.length === 1 ? '' : 's'}
              </span>
              <div className="channel-manage__row-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedId(expandedId === channel.id ? null : channel.id)}
                >
                  {expandedId === channel.id ? 'Hide subchannels' : 'Manage subchannels'}
                </Button>
                <Button variant="danger" size="sm" onClick={() => setPendingDeleteId(channel.id)}>
                  Delete
                </Button>
              </div>
            </div>
            {expandedId === channel.id && (
              <SubchannelManagePanel channel={channel} onClose={() => setExpandedId(null)} />
            )}
          </div>
        ))}
      </div>

      {pendingDeleteChannel && (
        <Modal title={`Delete "${pendingDeleteChannel.name}"?`} onClose={() => setPendingDeleteId(null)}>
          <div className="modal__body">
            This removes the channel, its subchannels, its cached stories, and any bookmarks saved under it.
            This can't be undone.
          </div>
          <div className="modal__actions">
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void api.deleteChannel(pendingDeleteChannel.id);
                setPendingDeleteId(null);
              }}
            >
              Delete channel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
