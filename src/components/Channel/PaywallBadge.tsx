import './PaywallBadge.css';

export function PaywallBadge({ paywalled }: { paywalled: boolean }) {
  if (!paywalled) return null;
  return (
    <span className="paywall-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 018 0v4" />
      </svg>
      Paywalled
    </span>
  );
}
