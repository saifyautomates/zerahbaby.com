import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, RotateCcw, ShieldAlert, WifiOff } from "lucide-react";
import { isChunkLoadError } from "@/lib/safe-lazy";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorType: "chunk" | "network" | "auth" | "render";
}

export class ComponentErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorType: "render",
  };

  public static getDerivedStateFromError(error: Error): State {
    let errorType: "chunk" | "network" | "auth" | "render" = "render";

    if (isChunkLoadError(error)) {
      errorType = "chunk";
    } else if (
      error?.message?.toLowerCase().includes("network") ||
      error?.message?.toLowerCase().includes("failed to fetch") ||
      (error?.name === "TypeError" && error?.message?.includes("fetch"))
    ) {
      errorType = "network";
    } else if (
      error?.message?.toLowerCase().includes("jwt") ||
      error?.message?.toLowerCase().includes("unauthorized") ||
      error?.message?.toLowerCase().includes("auth")
    ) {
      errorType = "auth";
    }

    return { hasError: true, error, errorType };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ComponentErrorBoundary] Caught component error:", {
      type: this.state.errorType,
      error,
      errorInfo,
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorType: "render" });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public override render() {
    if (this.state.hasError) {
      const { errorType, error } = this.state;

      let title = this.props.fallbackTitle || "Unable to display this section";
      let description = "A temporary issue occurred in this section. Click below to retry.";
      let Icon = AlertTriangle;

      if (errorType === "chunk") {
        title = "App Update Available";
        description =
          "A new version of the store application was deployed. Refresh the page to load the latest release.";
        Icon = RefreshCw;
      } else if (errorType === "network") {
        title = "Connection Error";
        description =
          "Unable to connect to the server. Please check your internet connection and retry.";
        Icon = WifiOff;
      } else if (errorType === "auth") {
        title = "Authentication Required";
        description = "Your session may have expired. Please refresh or re-authenticate.";
        Icon = ShieldAlert;
      }

      return (
        <div className="my-6 p-6 rounded-2xl border border-destructive/20 bg-destructive/5 text-center space-y-3 animate-in fade-in duration-300 max-w-xl mx-auto">
          <div className="size-10 mx-auto grid place-items-center rounded-xl bg-destructive/10 text-destructive">
            <Icon className="size-5" />
          </div>
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">{description}</p>

          {/* Collapsible Error Detail for Debugging */}
          {error?.message && (
            <div className="text-[11px] font-mono text-muted-foreground bg-muted/60 p-2.5 rounded-xl text-left overflow-x-auto max-h-24 no-scrollbar border border-border/40">
              <span className="font-semibold text-foreground/80">Diagnostic: </span>
              {error.message}
            </div>
          )}

          <div className="flex justify-center gap-2 pt-2">
            {errorType !== "chunk" && (
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold transition-all hover:bg-primary/90 cursor-pointer shadow-premium-sm"
              >
                <RotateCcw className="size-3.5" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-foreground text-xs font-bold transition-all hover:bg-muted cursor-pointer shadow-2xs"
            >
              <RefreshCw className="size-3.5" />
              Refresh page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
