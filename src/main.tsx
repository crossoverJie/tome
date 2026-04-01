import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Global error handlers to catch React crashes
window.addEventListener("error", (event) => {
  console.error("[Global] Uncaught error:", event.error);
  console.error("[Global] Error stack:", event.error?.stack);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[Global] Unhandled promise rejection:", event.reason);
});

// Memory usage logging
let lastMemoryLog = 0;
setInterval(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perf = performance as any;
  if (perf.memory) {
    const mem = perf.memory as {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
    const now = Date.now();
    if (now - lastMemoryLog > 30000) { // Log every 30 seconds
      console.log("[Memory] JS Heap:", {
        used: Math.round(mem.usedJSHeapSize / 1024 / 1024) + "MB",
        total: Math.round(mem.totalJSHeapSize / 1024 / 1024) + "MB",
        limit: Math.round(mem.jsHeapSizeLimit / 1024 / 1024) + "MB",
      });
      lastMemoryLog = now;
    }

    // Alert if memory is critically high
    if (mem.usedJSHeapSize > mem.jsHeapSizeLimit * 0.9) {
      console.error("[Memory] CRITICAL: Near heap limit!");
    }
  }
}, 5000);

const rootElement = document.getElementById("root");
if (!rootElement) {
  console.error("[Main] #root element not found!");
} else {
  console.log("[Main] Creating React root");
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
    console.log("[Main] React root rendered successfully");
  } catch (error) {
    console.error("[Main] Failed to render React:", error);
  }
}
