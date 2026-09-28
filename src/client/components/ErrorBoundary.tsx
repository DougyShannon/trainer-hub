import { Component, type ReactNode } from "react";

/**
 * Catches a crash while drawing a page and shows what went wrong, instead of leaving the
 * whole screen blank. `resetKey` clears the error when it changes (e.g. the page address).
 * `quiet` hides the broken part instead, for extras like the assistant button.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; quiet?: boolean }, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error("Page crashed", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="error-box crash-box" role="alert">
        <strong>Something went wrong showing this page.</strong>
        <p>Try reloading. If it keeps happening, send the site owner this message:</p>
        <code>{error.message || String(error)}</code>
        <button type="button" className="primary-btn small" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}
