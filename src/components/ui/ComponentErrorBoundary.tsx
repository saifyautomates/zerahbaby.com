import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ComponentErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ComponentErrorBoundary] Caught error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="my-6 p-6 rounded-2xl border border-destructive/20 bg-destructive/5 text-center space-y-3 animate-in fade-in duration-300">
          <div className="size-10 mx-auto grid place-items-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <h3 className="text-base font-bold text-foreground">
            {this.props.fallbackTitle || "Unable to display this section"}
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            A temporary loading issue occurred in this component. Click below to refresh this section.
          </p>
          <div className="flex justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold transition-all hover:bg-primary/90 cursor-pointer shadow-premium-sm"
            >
              <RefreshCw className="size-3.5" />
              Reload section
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-background text-foreground text-xs font-bold transition-all hover:bg-muted cursor-pointer"
            >
              Refresh full page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
