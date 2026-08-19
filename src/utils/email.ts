/** Deliberately permissive — this only exists to catch an obvious typo before it round-trips to the
 * server, not to fully validate RFC 5322. Shared by every place that asks for a free-text email
 * address (OnboardingWizard's digest step, DigestSetting's digest email field) so the two can't
 * silently drift apart. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
