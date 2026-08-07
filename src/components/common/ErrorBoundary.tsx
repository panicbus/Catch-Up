import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** A class component because React only supports error boundaries as class components — there is
 * no hook equivalent. Wraps the whole router in App.tsx.
 *
 * This was a known, previously-accepted gap (an uncaught error anywhere blanked the whole app with
 * nothing on screen — hit for real during a database outage). It stayed acceptable while every gate
 * in front of the app was optional. AuthGate changes that: it's now a MANDATORY, always-on-the-
 * critical-path gate every single page load depends on, so a bug there stops meaning "one feature
 * breaks" and starts meaning "the site never renders for anyone, ever" — a blast radius that finally
 * justifies closing this gap rather than continuing to accept it. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <p className="error-boundary__title">Something went wrong.</p>
          <p className="error-boundary__body">
            Catch Up hit an error it couldn’t recover from. Reloading usually fixes it.
          </p>
          <button type="button" className="error-boundary__action" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
