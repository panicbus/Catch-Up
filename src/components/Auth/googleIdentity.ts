/** Loads Google Identity Services (the script behind the "Sign in with Google" button) and gives
 * TypeScript a name for the global it attaches. Kept separate from SignInScreen.tsx so that
 * component can stay about the UI, not script-loading plumbing. */

/** Minimal ambient shape for `window.google` — only the two calls SignInScreen.tsx actually uses.
 * GIS has no official npm types package for this surface, and pulling in a broad third-party types
 * package for two methods isn't worth it. */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }): void;
          renderButton(
            parent: HTMLElement,
            options: { theme?: string; size?: string; width?: number }
          ): void;
        };
      };
    };
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const SCRIPT_ID = 'google-identity-services';

let loadPromise: Promise<void> | null = null;

/** Injects the script at most once per page load, however many times this is called (e.g.
 * SignInScreen mounting more than once across a sign-out/sign-in cycle) — later calls share the
 * first call's promise rather than re-injecting or re-fetching it. */
export function loadGoogleIdentityScript(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (document.getElementById(SCRIPT_ID)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Sign-In.'));
    document.head.appendChild(script);
  });
  return loadPromise;
}
