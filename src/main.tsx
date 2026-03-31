import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DiagnosticErrorBoundary } from "./components/DiagnosticErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DiagnosticErrorBoundary>
      <App />
    </DiagnosticErrorBoundary>
  </React.StrictMode>
);
