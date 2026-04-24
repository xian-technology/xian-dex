import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for debugging; nothing wider since we don't
    // ship telemetry.
    console.error("Render error:", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <AlertTriangle size={28} className="error-boundary-icon" />
          <h2>Something broke while rendering this page.</h2>
          <p className="muted small">
            The error has been logged to the browser console. You can try again or
            reload the page.
          </p>
          <pre className="error-boundary-message">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <div className="error-boundary-actions">
            <button className="btn btn-ghost" onClick={this.reset}>
              Dismiss
            </button>
            <button className="btn btn-primary" onClick={this.reload}>
              <RefreshCw size={14} /> Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
