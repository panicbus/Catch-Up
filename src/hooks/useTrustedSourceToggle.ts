import { useCallback, useMemo } from 'react';
import type { AppSettings } from '../../ipc-contract';

/** Derives the trust-toggle Set + flip handler NewsFeed/NewsCard want from a `{ settings, update }`
 * pair the caller already has from its own `useSettings()` call — deliberately NOT its own
 * `useSettings()` call, which would mean a second independent settings fetch + subscription on
 * every page that already has one (ChannelPage, PoolPage both already call it for defaultViewMode). */
export function useTrustedSourceToggle(
  settings: AppSettings,
  update: (partial: Partial<AppSettings>) => void
): { trustedSourceDomains: Set<string>; onToggleTrust: (domain: string) => void } {
  const trustedSourceDomains = useMemo(
    () => new Set(settings.trustedSourceDomains),
    [settings.trustedSourceDomains]
  );

  const onToggleTrust = useCallback(
    (domain: string) => {
      const next = trustedSourceDomains.has(domain)
        ? settings.trustedSourceDomains.filter((d) => d !== domain)
        : [...settings.trustedSourceDomains, domain];
      update({ trustedSourceDomains: next });
    },
    [trustedSourceDomains, settings.trustedSourceDomains, update]
  );

  return { trustedSourceDomains, onToggleTrust };
}
