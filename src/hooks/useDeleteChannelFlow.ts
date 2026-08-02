import { useState } from 'react';
import { api, revalidateNow } from '../services/api';
import * as channelsStore from '../services/channelsStore';
import type { Channel } from '../../ipc-contract';

/** Shared pending-delete-confirmation flow for a channel — used by Settings' channel list.
 * `onDeleted` is for anything a specific caller needs to do right after the delete IPC call fires
 * (e.g. navigating away if you just deleted the channel you're currently viewing). */
export function useDeleteChannelFlow(channels: Channel[], onDeleted?: (channelId: string) => void) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingChannel = channels.find((c) => c.id === pendingId) ?? null;

  const requestDelete = (channelId: string) => setPendingId(channelId);
  const cancel = () => setPendingId(null);
  const confirm = () => {
    if (!pendingChannel) return;
    const id = pendingChannel.id;
    // Optimistic: the row disappears immediately instead of waiting on the web build's poll cycle
    // (up to 20s) to reflect a delete that already succeeded. mutate() rolls back and resyncs on
    // its own if the request actually fails, so there's nothing more to do in the .catch here.
    channelsStore
      .mutate(
        (prev) => prev.filter((c) => c.id !== id),
        () => api.deleteChannel(id)
      )
      .then(() => revalidateNow())
      .catch(() => {});
    onDeleted?.(id);
    setPendingId(null);
  };

  return { pendingChannel, requestDelete, cancel, confirm };
}
