import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Called with the error + info whenever an error is caught.
   *  Use this to report to an error-tracking service. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — catches React render errors anywhere in the component tree
 * and displays a user-friendly fallback instead of a blank white screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <YourComponent />
 *   </ErrorBoundary>
 *
 * Note: ErrorBoundaries do NOT catch:
 *   - Event handlers (use try/catch there)
 *   - Async code (setState timing issues)
 *   - Server-side rendering errors
 *   - Errors thrown in the ErrorBoundary itself
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console in development; in production, call onError prop
    console.error("[ErrorBoundary] Unhandled render error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "2rem",
            background: "#1e1e1e",
            color: "#f87171",
            border: "1px solid #ef4444",
            borderRadius: "8px",
            fontFamily: "monospace",
            margin: "1rem",
          }}
        >
          <h2 style={{ margin: "0 0 0.5rem" }}>⚠ UI Error</h2>
          <p style={{ margin: "0 0 1rem", color: "#a1a1aa" }}>
            Something went wrong rendering this section.
          </p>
          {this.state.error && (
            <pre
              style={{
                background: "#111",
                padding: "0.75rem",
                borderRadius: "4px",
                overflow: "auto",
                fontSize: "0.8rem",
                color: "#fca5a5",
                maxHeight: "200px",
              }}
            >
              {this.state.error.name}: {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack?.split("\n").slice(0, 4).join("\n")}
            </pre>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "1rem",
              padding: "0.4rem 1rem",
              background: "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
