import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DiagnosticErrorBoundary } from "./components/DiagnosticErrorBoundary";
import { getRootDiagnosticsSnapshot, logDiagnostics } from "./utils/diagnostics";

window.addEventListener("error", (event) => {
  logDiagnostics("main", "window-error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error instanceof Error ? event.error : null,
    ...getRootDiagnosticsSnapshot(),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  logDiagnostics("main", "unhandled-rejection", {
    reason: event.reason instanceof Error ? event.reason : String(event.reason),
    ...getRootDiagnosticsSnapshot(),
  });
});

logDiagnostics("main", "renderer-bootstrap", getRootDiagnosticsSnapshot());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DiagnosticErrorBoundary>
      <App />
    </DiagnosticErrorBoundary>
  </React.StrictMode>
);
