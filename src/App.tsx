import { useState, useEffect, useCallback, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Settings } from "./components/Settings";
import { SplitPaneContainer } from "./components/SplitPaneContainer";
import { TabBar } from "./components/TabBar";
import { useTabs } from "./hooks/useTabs";
import "./App.css";

function App() {
  const {
    tabs,
    activeTabId,
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Get the currently focused pane's block info for copy command
  const getFocusedPaneBlocks = useCallback(() => {
    if (!focusedPaneId) return null;
    return blockSelectionMap.get(focusedPaneId) || null;
  }, [focusedPaneId, blockSelectionMap]);

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
        if (focusedPaneId) {
          splitPane(focusedPaneId, "horizontal");
        }
        return;
      }

      // Split vertically: Cmd+Shift+D
      if (e.metaKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        if (focusedPaneId) {
          splitPane(focusedPaneId, "vertical");
        }
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
    splitPane,
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
  }, [tabs]);

  return (
    <div className="app" ref={containerRef}>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <TabBar
        tabs={tabs}
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
            containerRef={containerRef}
          />
        </div>
      ))}
    </div>
  );
}

export default App;
