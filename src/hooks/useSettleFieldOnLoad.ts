import { useEffect, useRef } from 'react';

/** Corrects local editable state that had to be guessed via a useState initializer before an async
 * settings fetch (useSettings, etc.) resolved — see LocationSetting.tsx / DigestSetting.tsx, both of
 * which seed a text field from `settings.something` at mount. A useState initializer only ever runs
 * once, so without this, a value that was saved correctly server-side the whole time can render as
 * blank/wrong on every single visit, forever — confirmed live as exactly that: a home location that
 * was never actually lost, just never displayed once it had loaded.
 *
 * Runs `apply` exactly once, the first time `loading` flips to false — never again after that, so it
 * doesn't fight whatever the user does to the field afterward. Skipped entirely if `hasInteracted` is
 * already true by the time that happens, so a user who starts typing during the (typically brief)
 * load window never has their own in-progress input silently overwritten a moment later — a real risk
 * particularly for a field that's already been reported broken once, where "immediately retype it,
 * assuming it's still blank" is a plausible reflex. */
export function useSettleFieldOnLoad(loading: boolean, hasInteracted: boolean, apply: () => void): void {
  const settledRef = useRef(false);
  useEffect(() => {
    if (loading || settledRef.current || hasInteracted) return;
    settledRef.current = true;
    apply();
    // apply is a fresh closure every render, capturing that render's own settings value — the effect
    // only ever actually calls it on the one render where `loading` flips false, so it's always
    // current there regardless of not being listed as a dependency. Deliberately excluded: including
    // it would re-run this effect on every unrelated render (a new closure identity each time), which
    // settledRef already makes harmless but still wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasInteracted]);
}
