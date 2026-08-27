"use client";

import { Component, type ReactNode } from "react";
import { usePathname } from "next/navigation";

interface Props {
  children: ReactNode;
  /** Changes on every route change — see componentDidUpdate. */
  resetKey: string;
}

interface State {
  hasError: boolean;
  message: string;
}

// Deliberately hand-rolled markup rather than <Button>/<Link>: this boundary is
// the last thing standing when a render throws, so it must not depend on the
// component layer that may be what broke. The plain <a> is also the point — it
// is a real document navigation, which works even with the React tree wedged.
const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors min-h-[44px] sm:min-h-0";

class ErrorBoundaryInner extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? "" };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  // The reset key this boundary never had. Without it the fallback was pinned
  // for the rest of the session: while `hasError` is set the router subtree is
  // unmounted, so even the browser's Back button changed the URL and left the
  // same error on screen. `resetKey` is the pathname, threaded in by the
  // wrapper below — the `children` comparison is a second, weaker guard,
  // because the root layout hands this boundary the *same* children element for
  // the life of the document. A genuinely deterministic error just throws again
  // and lands back here, which is why "Reload Page" alone used to be a loop.
  componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError) return;
    if (prevProps.resetKey !== this.props.resetKey || prevProps.children !== this.props.children) {
      this.setState({ hasError: false, message: "" });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md">
            An unexpected error occurred. Try again — if it keeps happening, reload the
            page or go back to your summary.
          </p>
          {this.state.message && (
            <p className="max-w-md break-words font-mono text-sm text-danger">
              {this.state.message}
            </p>
          )}
          {/* This boundary wraps the whole AppShell, so no nav renders behind
              it — without an explicit way out the only escape was the browser's
              own back button. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className={`${BUTTON_BASE} bg-primary text-primary-foreground hover:bg-primary/90`}
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`${BUTTON_BASE} border bg-background hover:bg-accent hover:text-accent-foreground`}
            >
              Reload Page
            </button>
            <a
              href="/summary"
              className={`${BUTTON_BASE} border bg-background hover:bg-accent hover:text-accent-foreground`}
            >
              Go to Summary
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * A class component cannot read the router itself, and the root layout is a
 * server component that renders this exactly once — so `children` is a single
 * stable element and could never act as a reset key on its own. usePathname()
 * subscribes to the router context that sits ABOVE the layout output, so this
 * wrapper re-renders on every navigation, including Back, even while the
 * boundary is holding the fallback and the whole router subtree is unmounted.
 */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <ErrorBoundaryInner resetKey={pathname}>{children}</ErrorBoundaryInner>;
}
