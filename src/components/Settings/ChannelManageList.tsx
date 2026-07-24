import { useState, type KeyboardEvent } from 'react';
import { api } from '../../services/api';
import { useChannels } from '../../hooks/useChannels';
import { useDeleteChannelFlow } from '../../hooks/useDeleteChannelFlow';
import { SubchannelManagePanel } from '../common/SubchannelManagePanel';
import { DeleteChannelModal } from '../common/DeleteChannelModal';
import { Button } from '../common/Button';
import './ChannelManageList.css';

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChannelManageList() {
  const { channels } = useChannels();
  const [draft, setDraft] = useState('');
  const [listOpen, setListOpen] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const { pendingChannel, requestDelete, cancel, confirm } = useDeleteChannelFlow(channels);

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

  return (
    <div className="channel-manage">
      <div className="channel-manage__add-row">
        <input
          className="channel-manage__input"
          type="text"
          placeholder="Add a new channel, any topic…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Add a channel"
        />
        <Button variant="primary" onClick={addChannel} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      <div className="channel-manage__box">
        <button
          type="button"
          className="channel-manage__toggle"
          onClick={() => setListOpen((v) => !v)}
          aria-expanded={listOpen}
        >
          <ChevronIcon open={listOpen} />
          <span className="channel-manage__toggle-label">Channels</span>
          <span className="channel-manage__toggle-count">
            {channels.length === 0 ? 'none yet' : channels.length}
          </span>
        </button>

        <div className={`channel-manage__body ${listOpen ? 'channel-manage__body--open' : ''}`}>
          <div className="channel-manage__body-inner">
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
                <Button variant="danger" size="sm" onClick={() => requestDelete(channel.id)}>
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
          </div>
        </div>
      </div>

      <DeleteChannelModal channel={pendingChannel} onCancel={cancel} onConfirm={confirm} />
    </div>
  );
}
