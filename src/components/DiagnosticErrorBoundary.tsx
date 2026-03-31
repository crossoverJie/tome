import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  getRootDiagnosticsSnapshot,
  isDiagnosticsEnabled,
  logDiagnostics,
} from "../utils/diagnostics";

interface DiagnosticErrorBoundaryProps {
  children: ReactNode;
}

interface DiagnosticErrorBoundaryState {
  hasError: boolean;
}

export class DiagnosticErrorBoundary extends Component<
  DiagnosticErrorBoundaryProps,
  DiagnosticErrorBoundaryState
> {
  state: DiagnosticErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logDiagnostics("DiagnosticErrorBoundary", "react-error", {
      error,
      componentStack: errorInfo.componentStack,
      ...getRootDiagnosticsSnapshot(),
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="diagnostic-error-boundary" role="alert">
        <strong>Renderer error captured.</strong>
        <span>
          {isDiagnosticsEnabled()
            ? "Check the diagnostics logs in the console for the last recorded state."
            : "Reload the window to recover."}
        </span>
      </div>
    );
  }
}
