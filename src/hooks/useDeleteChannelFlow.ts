import { useState } from 'react';
import { api } from '../services/api';
import type { Channel } from '../../ipc-contract';

/** Shared pending-delete-confirmation flow for a channel — used by both the sidebar's per-row X
 * and Settings' channel list, so the two implementations can't drift apart on behavior or copy.
 * `onDeleted` is for anything a specific caller needs to do right after the delete IPC call fires
 * (e.g. the sidebar navigating away if you just deleted the channel you're currently viewing). */
export function useDeleteChannelFlow(channels: Channel[], onDeleted?: (channelId: string) => void) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingChannel = channels.find((c) => c.id === pendingId) ?? null;

  const requestDelete = (channelId: string) => setPendingId(channelId);
  const cancel = () => setPendingId(null);
  const confirm = () => {
    if (!pendingChannel) return;
    void api.deleteChannel(pendingChannel.id);
    onDeleted?.(pendingChannel.id);
    setPendingId(null);
  };

  return { pendingChannel, requestDelete, cancel, confirm };
}
