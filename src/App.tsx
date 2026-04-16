import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Settings } from "./components/Settings";
import { SplitPaneContainer } from "./components/SplitPaneContainer";
import { TabBar } from "./components/TabBar";
import { useTabs } from "./hooks/useTabs";
import {
  setPaneSessionInitOptions,
  setPaneAgentState,
  removePaneAgentState,
  removePaneOutputAndActivity,
  getPaneAgentState,
} from "./hooks/sessionState";
import { getRootDiagnosticsSnapshot, logDiagnostics } from "./utils/diagnostics";
import { getTabCurrentDirectory, getDirectoryLabel } from "./utils/workdir";
import {
  aggregateTabAgentSummary,
  createTabPresentation,
  type PaneAgentState,
} from "./utils/agentStatus";
import type { AiAgentKind } from "./utils/fullscreenSessionState";
import { useWindowSnapshot } from "./hooks/useWindowSnapshot";
import { Overview } from "./pages/Overview";
import "./App.css";

// Check if this is the overview window
const isOverviewWindow = window.location.pathname === "/overview";

console.log("[App] pathname:", window.location.pathname, "isOverviewWindow:", isOverviewWindow);

function App() {
  if (isOverviewWindow) {
    console.log("[App] Rendering Overview component");
    return <Overview />;
  }

  const {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    createTabWithCwd,
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
  // Track pane agent states for tab agent status display
  const [paneAgentMap, setPaneAgentMap] = useState<Map<string, PaneAgentState>>(new Map());

  // Window snapshot reporting
  useWindowSnapshot({
    tabs,
    activeTabId,
    paneAgentMap,
    paneDirectoryMap,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const latestAppSnapshotRef = useRef<Record<string, unknown> | null>(null);
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

  useEffect(() => {
    latestAppSnapshotRef.current = createAppDiagnosticsSnapshot("latest");
  }, [createAppDiagnosticsSnapshot]);

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

  // Handle agent state changes from panes
  const handleAgentStateChange = useCallback(
    (paneId: string, aiAgentKind: AiAgentKind, isActive: boolean) => {
      setPaneAgentMap((prev) => {
        const next = new Map(prev);
        if (isActive && aiAgentKind !== null) {
          // Get existing conversation data from pane state if available
          const existingPaneState = getPaneAgentState(paneId);
          const state: PaneAgentState = {
            aiAgentKind,
            isActive: true,
            conversationHistory: existingPaneState?.conversationHistory ?? [],
            totalRounds: existingPaneState?.totalRounds ?? 0,
          };
          next.set(paneId, state);
          // Also persist to session state
          setPaneAgentState(paneId, state);
        } else {
          // When agent exits, just remove from the map but KEEP the conversation history
          // in the registry for future reference
          next.delete(paneId);
          // Do NOT call removePaneAgentState() - we want to preserve the history
        }
        return next;
      });
    },
    []
  );

  // Aggregate tab agent summaries and create presentations
  const tabPresentations = useMemo(() => {
    const presentations = new Map<string, { label: string; tooltip: string }>();
    for (const tab of tabs) {
      const summary = aggregateTabAgentSummary(tab, paneAgentMap);
      const dirPath = getTabCurrentDirectory(tab, paneDirectoryMap);
      const dirName = dirPath ? getDirectoryLabel(dirPath) : "Shell";
      const presentation = createTabPresentation(dirName, dirPath, summary);
      presentations.set(tab.id, presentation);
    }
    return presentations;
  }, [tabs, paneAgentMap, paneDirectoryMap]);

  const activeTabCurrentDirectory = useMemo(
    () => getTabCurrentDirectory(activeTab, paneDirectoryMap),
    [activeTab, paneDirectoryMap]
  );

  // Get window title from current directory (without agent tokens)
  const windowTitle = useMemo(() => {
    return activeTabCurrentDirectory ? `${activeTabCurrentDirectory} — Tome` : "Tome";
  }, [activeTabCurrentDirectory]);

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
      if (e.metaKey) {
        logDiagnostics("App", "shortcut", {
          key: e.key,
          shiftKey: e.shiftKey,
          ...createAppDiagnosticsSnapshot("shortcut"),
        });
      }

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
    createAppDiagnosticsSnapshot,
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

    // Clean up pane agent states for closed panes
    setPaneAgentMap((prev) => {
      const newMap = new Map(prev);
      for (const paneId of newMap.keys()) {
        if (!allPaneIds.has(paneId)) {
          newMap.delete(paneId);
          removePaneAgentState(paneId);
          removePaneOutputAndActivity(paneId);
        }
      }
      return newMap;
    });
  }, [tabs]);

  useEffect(() => {
    const title = windowTitle;
    document.title = title;
    void getCurrentWindow()
      .setTitle(title)
      .catch((error) => {
        console.error("Failed to update window title", error);
      });
  }, [windowTitle]);

  useEffect(() => {
    logDiagnostics("App", "mount", createAppDiagnosticsSnapshot("mount"));

    return () => {
      logDiagnostics("App", "unmount", {
        ...(latestAppSnapshotRef.current ?? {}),
        reason: "unmount",
      });
    };
  }, []);

  useEffect(() => {
    logDiagnostics("App", "state-change", createAppDiagnosticsSnapshot("state-change"));
  }, [createAppDiagnosticsSnapshot]);

  useEffect(() => {
    const logWindowEvent = (eventName: string) => {
      logDiagnostics("App", eventName, createAppDiagnosticsSnapshot(eventName));
    };

    const handleVisibilityChange = () => logWindowEvent("visibilitychange");
    const handleFocus = () => logWindowEvent("window-focus");
    const handleBlur = () => logWindowEvent("window-blur");
    const handleResize = () => logWindowEvent("window-resize");
    const handlePageShow = () => logWindowEvent("pageshow");
    const handlePageHide = () => logWindowEvent("pagehide");

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

  // Listen for focus-pane events from menu bar overview
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ tab_id: string; pane_id: string }>("focus-pane", (event) => {
        const { tab_id, pane_id } = event.payload;

        // Switch to the target tab first
        switchTab(tab_id);

        // Wait for tab switch to complete before focusing pane
        // Use requestAnimationFrame to ensure React state update has applied
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            focusPane(pane_id);
          });
        });

        // Activate this window
        void getCurrentWindow().setFocus();

        logDiagnostics("App", "focus-pane", {
          ...createAppDiagnosticsSnapshot("focus-pane"),
          targetTabId: tab_id,
          targetPaneId: pane_id,
        });
      });
    };

    void setupListener();

    return () => {
      unlisten?.();
    };
  }, [switchTab, focusPane, createAppDiagnosticsSnapshot]);

  // Unregister window when closing
  useEffect(() => {
    const handleBeforeUnload = () => {
      const unregister = async () => {
        try {
          const window = await getCurrentWindow();
          await invoke("unregister_window", { windowLabel: window.label });
        } catch (error) {
          console.error("[App] Failed to unregister window:", error);
        }
      };
      void unregister();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <div className="app" ref={containerRef}>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={switchTab}
        onCreateTab={createTab}
        onCloseTab={closeTab}
        tabPresentations={tabPresentations}
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
            onAgentStateChange={handleAgentStateChange}
            onOpenPathInNewTab={createTabWithCwd}
          />
        </div>
      ))}
    </div>
  );
}

export default App;
