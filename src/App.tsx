import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Settings } from "./components/Settings";
import { SplitPaneContainer } from "./components/SplitPaneContainer";
import { TabBar } from "./components/TabBar";
import { useTabs } from "./hooks/useTabs";
import { setPaneSessionInitOptions } from "./hooks/sessionState";
import {
  getRootDiagnosticsSnapshot,
  isDiagnosticsEnabled,
  logDiagnostics,
} from "./utils/diagnostics";
import { getTabCurrentDirectory, getTabDisplayTitle, getWindowTitle } from "./utils/workdir";
import "./App.css";

function App() {
  const {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    switchTab,
    switchTabByIndex,
    focusedPaneId,
    splitPane,
    closePane,
    focusPane,
    focusNextPane,
    focusPrevPane,
    updateSplitRatio,
  } = useTabs();

  const [showSettings, setShowSettings] = useState(false);
  const [blockSelectionMap, setBlockSelectionMap] = useState<
    Map<string, { index: number | null; blocks: unknown[] }>
  >(new Map());
  const [paneDirectoryMap, setPaneDirectoryMap] = useState<Map<string, string | null>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const totalPaneCount = useMemo(
    () => tabs.reduce((count, tab) => count + tab.panes.size, 0),
    [tabs]
  );

  const createAppDiagnosticsSnapshot = useCallback(
    (reason: string) => ({
      reason,
      totalTabs: tabs.length,
      totalPanes: totalPaneCount,
      activeTabId,
      activeTabRootPaneId: activeTab?.rootPaneId ?? null,
      activeTabPaneCount: activeTab?.panes.size ?? 0,
      focusedPaneId,
      showSettings,
      ...getRootDiagnosticsSnapshot(),
    }),
    [activeTab, activeTabId, focusedPaneId, showSettings, tabs.length, totalPaneCount]
  );

  // Get the currently focused pane's block info for copy command
  const getFocusedPaneBlocks = useCallback(() => {
    if (!focusedPaneId) return null;
    return blockSelectionMap.get(focusedPaneId) || null;
  }, [focusedPaneId, blockSelectionMap]);

  const handleWorkingDirectoryChange = useCallback(
    (paneId: string, currentDirectory: string | null) => {
      setPaneDirectoryMap((prev) => {
        const nextValue = currentDirectory ?? null;
        if ((prev.get(paneId) ?? null) === nextValue) {
          return prev;
        }

        const next = new Map(prev);
        if (nextValue) {
          next.set(paneId, nextValue);
        } else {
          next.delete(paneId);
        }
        return next;
      });
    },
    []
  );

  const displayTabs = useMemo(
    () => tabs.map((tab) => ({ ...tab, title: getTabDisplayTitle(tab, paneDirectoryMap) })),
    [tabs, paneDirectoryMap]
  );

  const activeTabCurrentDirectory = useMemo(
    () => getTabCurrentDirectory(activeTab, paneDirectoryMap),
    [activeTab, paneDirectoryMap]
  );

  const handleSplitPane = useCallback(
    (direction: "horizontal" | "vertical") => {
      if (!focusedPaneId) {
        return;
      }

      const newPaneId = splitPane(focusedPaneId, direction);
      if (!newPaneId) {
        return;
      }

      const sourceCwd = paneDirectoryMap.get(focusedPaneId) ?? null;
      if (sourceCwd) {
        setPaneSessionInitOptions(newPaneId, { initialCwd: sourceCwd });
      }
    },
    [focusedPaneId, paneDirectoryMap, splitPane]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Settings toggle: Cmd+,
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
        return;
      }

      // New window: Cmd+N
      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        const label = `tome-${Date.now()}`;
        new WebviewWindow(label, {
          title: "Tome",
          width: 1000,
          height: 700,
          url: "/",
        });
        return;
      }

      // New tab: Cmd+T
      if (e.metaKey && e.key === "t") {
        e.preventDefault();
        createTab();
        return;
      }

      // Switch tab by index: Cmd+1..9
      if (e.metaKey && e.key >= "1" && e.key <= "9" && !e.shiftKey) {
        e.preventDefault();
        switchTabByIndex(parseInt(e.key) - 1);
        return;
      }

      // Split horizontally: Cmd+D
      if (e.metaKey && e.key === "d" && !e.shiftKey) {
        e.preventDefault();
        handleSplitPane("horizontal");
        return;
      }

      // Split vertically: Cmd+Shift+D
      if (e.metaKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        handleSplitPane("vertical");
        return;
      }

      // Close pane/tab: Cmd+W
      if (e.metaKey && e.key === "w") {
        e.preventDefault();
        if (focusedPaneId) {
          const result = closePane(focusedPaneId);
          if (result.shouldCloseWindow) {
            window.close();
          }
        }
        return;
      }

      // Focus previous pane: Cmd+[
      if (e.metaKey && e.key === "[") {
        e.preventDefault();
        focusPrevPane();
        return;
      }

      // Focus next pane: Cmd+]
      if (e.metaKey && e.key === "]") {
        e.preventDefault();
        focusNextPane();
        return;
      }

      // Copy selected block output: Cmd+Shift+C
      if (e.metaKey && e.shiftKey && e.key === "C") {
        e.preventDefault();
        const paneInfo = getFocusedPaneBlocks();
        if (paneInfo && paneInfo.index !== null && paneInfo.blocks[paneInfo.index]) {
          const block = paneInfo.blocks[paneInfo.index] as { output: string };
          navigator.clipboard.writeText(block.output);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    createTab,
    switchTabByIndex,
    handleSplitPane,
    closePane,
    focusPane,
    focusNextPane,
    focusPrevPane,
    focusedPaneId,
    getFocusedPaneBlocks,
  ]);

  // Clean up closed pane data from blockSelectionMap
  useEffect(() => {
    const allPaneIds = new Set<string>();
    for (const tab of tabs) {
      for (const paneId of tab.panes.keys()) {
        allPaneIds.add(paneId);
      }
    }

    setBlockSelectionMap((prev) => {
      const newMap = new Map(prev);
      for (const paneId of newMap.keys()) {
        if (!allPaneIds.has(paneId)) {
          newMap.delete(paneId);
        }
      }
      return newMap;
    });

    setPaneDirectoryMap((prev) => {
      const newMap = new Map(prev);
      for (const paneId of newMap.keys()) {
        if (!allPaneIds.has(paneId)) {
          newMap.delete(paneId);
        }
      }
      return newMap;
    });
  }, [tabs]);

  useEffect(() => {
    const title = getWindowTitle(activeTabCurrentDirectory);
    document.title = title;
    void getCurrentWindow()
      .setTitle(title)
      .catch((error) => {
        console.error("Failed to update window title", error);
      });
  }, [activeTabCurrentDirectory]);

  useEffect(() => {
    logDiagnostics("App", "mount", createAppDiagnosticsSnapshot("mount"));
    return () => {
      logDiagnostics("App", "unmount", createAppDiagnosticsSnapshot("unmount"));
    };
  }, [createAppDiagnosticsSnapshot]);

  useEffect(() => {
    logDiagnostics("App", "state-change", createAppDiagnosticsSnapshot("state-change"));
  }, [createAppDiagnosticsSnapshot]);

  useEffect(() => {
    const logWindowLifecycle = (eventName: string) => {
      logDiagnostics("App", eventName, createAppDiagnosticsSnapshot(eventName));
    };

    const handleVisibilityChange = () => logWindowLifecycle("document.visibilitychange");
    const handleFocus = () => logWindowLifecycle("window.focus");
    const handleBlur = () => logWindowLifecycle("window.blur");
    const handleResize = () => logWindowLifecycle("window.resize");
    const handlePageShow = () => logWindowLifecycle("window.pageshow");
    const handlePageHide = () => logWindowLifecycle("window.pagehide");

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", handleResize);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [createAppDiagnosticsSnapshot]);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      logDiagnostics("App", "window.error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
        ...createAppDiagnosticsSnapshot("window.error"),
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logDiagnostics("App", "window.unhandledrejection", {
        rejectionReason: event.reason,
        ...createAppDiagnosticsSnapshot("window.unhandledrejection"),
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [createAppDiagnosticsSnapshot]);

  useEffect(() => {
    if (!isDiagnosticsEnabled()) {
      return;
    }

    const heartbeat = window.setInterval(() => {
      logDiagnostics("App", "heartbeat", createAppDiagnosticsSnapshot("heartbeat"));
    }, 5000);

    return () => {
      window.clearInterval(heartbeat);
    };
  }, [createAppDiagnosticsSnapshot]);

  return (
    <div className="app" ref={containerRef}>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <TabBar
        tabs={displayTabs}
        activeTabId={activeTabId}
        onSwitchTab={switchTab}
        onCreateTab={createTab}
        onCloseTab={closeTab}
      />
      {tabs.map((tab) => (
        <div key={tab.id} className={`tab-content ${tab.id !== activeTabId ? "hidden" : ""}`}>
          <SplitPaneContainer
            paneId={tab.rootPaneId}
            panes={tab.panes}
            focusedPaneId={tab.id === activeTabId ? tab.focusedPaneId : null}
            onFocusPane={focusPane}
            onUpdateSplitRatio={updateSplitRatio}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
            containerRef={containerRef}
          />
        </div>
      ))}
    </div>
  );
}

export default App;
