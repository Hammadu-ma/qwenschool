import { Component, type ReactNode } from "react";

/**
 * Suspense only catches the *pending* promise of a lazy import — if the
 * chunk request itself fails (dev server restarted mid-session, a stale
 * cached index.html pointing at chunk hashes that no longer exist after a
 * rebuild, a flaky connection), the import throws and Suspense has nothing
 * to show, so the fallback is left on screen forever with no error surfaced
 * anywhere. That's the "sometimes it just doesn't load, silently" failure
 * mode. An error boundary is required to catch that — Suspense alone can't.
 */
export const isChunkLoadError = (err: unknown) =>
  err instanceof Error && /dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk/i.test(err.message);

const RELOAD_GUARD_KEY = "riverside.chunk-reload";

/** Call once, anywhere that's reliably rendered after a successful load
 *  (e.g. the app root), so a *future* stale-chunk error after the next
 *  deploy is still allowed to trigger one automatic reload. */
export function clearChunkReloadGuard() {
  try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* ignore */ }
}

export class ChunkErrorBoundary extends Component<
  { resetKey?: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Stale-chunk errors are the common case after a redeploy — the fix is
    // a full reload so the browser picks up the current index.html and its
    // (now-matching) chunk manifest. Guard with sessionStorage so a genuine,
    // persistent load failure doesn't reload-loop forever.
    try {
      if (isChunkLoadError(error) && !sessionStorage.getItem(RELOAD_GUARD_KEY)) {
        sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
        window.location.reload();
      }
    } catch { /* sessionStorage blocked — fall through to the retry button */ }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Navigating to a different route (or reopening a modal) after a
    // failure gets a clean retry instead of staying stuck on the old error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <p className="text-[14px] font-semibold text-ink">This didn't load.</p>
          <p className="max-w-sm text-[12px] text-soft">
            That's usually a connection hiccup or a new version having been deployed. Reloading almost always fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-pine-700 px-4 py-2 text-[12px] font-semibold text-white hover:bg-pine-800"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
