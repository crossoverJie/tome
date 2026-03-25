import { useState, useEffect, useCallback, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Settings } from "./components/Settings";
import { SplitPaneContainer } from "./components/SplitPaneContainer";
import { useSplitPanes } from "./hooks/useSplitPanes";
import "./App.css";

function App() {
  const {
    rootPaneId,
    panes,
    focusedPaneId,
    splitPane,
    closePane,
    focusPane,
    focusNextPane,
    focusPrevPane,
    updateSplitRatio,
  } = useSplitPanes();

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

      // Split horizontally: Cmd+D
      if (e.metaKey && e.key === "d" && !e.shiftKey) {
        e.preventDefault();
        if (focusedPaneId) {
          splitPane(focusedPaneId, "horizontal");
        }
        return;
      }

      // Split vertically: Cmd+Shift+D
      if (e.metaKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        if (focusedPaneId) {
          splitPane(focusedPaneId, "vertical");
        }
        return;
      }

      // Close pane: Cmd+W
      if (e.metaKey && e.key === "w") {
        e.preventDefault();
        if (focusedPaneId) {
          const result = closePane(focusedPaneId);
          if (result.shouldCloseWindow) {
            // Signal to Tauri to close the window
            // We'll use window.close() for now as getCurrentWindow is not available
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
    splitPane,
    closePane,
    focusPane,
    focusNextPane,
    focusPrevPane,
    focusedPaneId,
    getFocusedPaneBlocks,
  ]);

  // Clean up closed pane data
  useEffect(() => {
    setBlockSelectionMap((prev) => {
      const newMap = new Map(prev);
      for (const paneId of newMap.keys()) {
        if (!panes.has(paneId)) {
          newMap.delete(paneId);
        }
      }
      return newMap;
    });
  }, [panes]);

  // Close sessions for removed panes
  useEffect(() => {
    const activeSessionIds = new Set<string>();
    for (const pane of panes.values()) {
      if (pane.type === "leaf" && pane.sessionId) {
        activeSessionIds.add(pane.sessionId);
      }
    }

    // Note: Session cleanup happens in the closePane function
    // This effect is for any additional cleanup if needed
  }, [panes]);

  return (
    <div className="app" ref={containerRef}>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {rootPaneId && (
        <SplitPaneContainer
          paneId={rootPaneId}
          panes={panes}
          focusedPaneId={focusedPaneId}
          onFocusPane={focusPane}
          onUpdateSplitRatio={updateSplitRatio}
          containerRef={containerRef}
        />
      )}
    </div>
  );
}

export default App;
