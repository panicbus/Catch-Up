import { useState, type KeyboardEvent } from 'react';
import { api, revalidateNow } from '../../services/api';
import * as channelsStore from '../../services/channelsStore';
import { suggestSubchannels } from '../../utils/subchannelSuggestions';
import { capitalizeWords } from '../../../channelName';
import type { Channel } from '../../../ipc-contract';
import './SubchannelManagePanel.css';

interface SubchannelManagePanelProps {
  channel: Channel;
  onClose: () => void;
}

export function SubchannelManagePanel({ channel, onClose }: SubchannelManagePanelProps) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const suggestions = suggestSubchannels(channel.name).filter(
    (s) => !channel.subchannels.some((sc) => sc.name.toLowerCase() === s.toLowerCase())
  );

  const addSubchannel = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const label = capitalizeWords(trimmed);
    const tempId = `temp-${Date.now()}`;
    channelsStore
      .mutate(
        (prev) =>
          prev.map((c) =>
            c.id === channel.id
              ? { ...c, subchannels: [...c.subchannels, { id: tempId, name: label, createdAt: new Date().toISOString() }] }
              : c
          ),
        async () => {
          const real = await api.addSubchannel(channel.id, trimmed);
          const current = channelsStore.getSnapshot() ?? [];
          channelsStore.ingest(
            current.map((c) =>
              c.id === channel.id
                ? { ...c, subchannels: c.subchannels.map((sc) => (sc.id === tempId ? real : sc)) }
                : c
            )
          );
          return real;
        }
      )
      .then(() => revalidateNow())
      .catch(() => {});
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSubchannel(draft);
    }
  };

  const startEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      const subId = editingId;
      const trimmed = editValue.trim();
      const label = capitalizeWords(trimmed);
      channelsStore
        .mutate(
          (prev) =>
            prev.map((c) =>
              c.id === channel.id
                ? { ...c, subchannels: c.subchannels.map((sc) => (sc.id === subId ? { ...sc, name: label } : sc)) }
                : c
            ),
          () => api.renameSubchannel(channel.id, subId, trimmed)
        )
        .then(() => revalidateNow())
        .catch(() => {});
    }
    setEditingId(null);
  };

  return (
    <div className="subchannel-panel">
      <div className="subchannel-panel__header">
        <span className="subchannel-panel__title">Subchannels of "{channel.name}"</span>
        <button
          type="button"
          className="subchannel-panel__close"
          onClick={onClose}
          aria-label="Close subchannel manager"
        >
          Done ×
        </button>
      </div>
      <div className="subchannel-panel__add-row">
        <input
          className="subchannel-panel__input"
          type="text"
          placeholder={`Add a subchannel under "${channel.name}"…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={`Add subchannel to ${channel.name}`}
        />
      </div>

      {suggestions.length > 0 && (
        <div className="subchannel-panel__suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="subchannel-panel__suggestion" onClick={() => addSubchannel(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}

      <ul className="subchannel-panel__list">
        {channel.subchannels.length === 0 && (
          <li className="subchannel-panel__empty">No subchannels yet.</li>
        )}
        {channel.subchannels.map((sub) => (
          <li key={sub.id} className="subchannel-panel__row">
            {editingId === sub.id ? (
              <input
                className="subchannel-panel__row-input"
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
              <span onClick={() => startEdit(sub.id, sub.name)} style={{ flex: 1, cursor: 'text' }}>
                {sub.name}
              </span>
            )}
            <button
              type="button"
              className="subchannel-panel__row-delete"
              onClick={() =>
                channelsStore
                  .mutate(
                    (prev) =>
                      prev.map((c) =>
                        c.id === channel.id
                          ? { ...c, subchannels: c.subchannels.filter((sc) => sc.id !== sub.id) }
                          : c
                      ),
                    () => api.deleteSubchannel(channel.id, sub.id)
                  )
                  .then(() => revalidateNow())
                  .catch(() => {})
              }
              aria-label={`Delete ${sub.name}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
