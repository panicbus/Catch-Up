import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { ProviderStatus } from '../../../ipc-contract';
import './ProviderStatusPanel.css';

export function ProviderStatusPanel() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    void api.getProviderStatus().then(setProviders);
  }, []);

  return (
    <div className="provider-status">
      {providers.map((p) => (
        <div key={p.id} className="provider-status__row">
          <span
            className={`provider-status__dot ${
              p.rateLimited
                ? 'provider-status__dot--warn'
                : p.configured
                  ? 'provider-status__dot--on'
                  : ''
            }`}
          />
          <span>{p.label}</span>
          <span style={{ color: 'var(--text-faint)' }}>
            {p.rateLimited
              ? 'Rate limited — pausing for a bit'
              : p.configured
                ? 'Configured'
                : 'Not configured'}
          </span>
        </div>
      ))}
      <p className="provider-status__note">
        API keys are set via environment variables (see .env.example) — there's no in-app key entry yet.
      </p>
    </div>
  );
}
