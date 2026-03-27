import { useState, useCallback, useRef, useMemo } from "react";
import type { SplitDirection } from "../types/pane";
import {
  splitPane as splitPaneTree,
  removePane as removePaneFromTree,
  findAdjacentLeafPaneId,
  findParentPaneId,
  getLeafPaneIds,
} from "../types/pane";
import type { Tab } from "../types/tab";
import { createTab as createTabData } from "../types/tab";
import {
  removePaneMapping,
  removePaneSessionInitOptions,
  removeSessionState,
} from "./sessionState";

export interface UseTabsReturn {
  // Tab operations
  tabs: Tab[];
  activeTabId: string;
  activeTab: Tab;
  createTab: () => void;
  closeTab: (tabId: string) => { shouldCloseWindow: boolean; removedSessionIds: string[] };
  switchTab: (tabId: string) => void;
  switchTabByIndex: (index: number) => void;

  // Pane operations (scoped to active tab)
  focusedPaneId: string | null;
  splitPane: (paneId: string, direction: SplitDirection, keepSessionId?: string) => string | null;
  closePane: (paneId: string) => { removedSessionIds: string[]; shouldCloseWindow: boolean };
  focusPane: (paneId: string | null) => void;
  focusNextPane: () => void;
  focusPrevPane: () => void;
  updateSplitRatio: (paneId: string, ratio: number) => void;
}

export function useTabs(): UseTabsReturn {
  const idCounter = useRef(0);
  const generateId = useCallback((prefix: string) => {
    return `${prefix}-${++idCounter.current}-${Date.now()}`;
  }, []);

  // Initialize with single tab
  const initialTabId = useMemo(() => generateId("tab"), [generateId]);
  const initialPaneId = useMemo(() => generateId("pane"), [generateId]);

  const [tabs, setTabs] = useState<Tab[]>(() => [createTabData(initialTabId, initialPaneId)]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId);

  // Derived: active tab
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  const focusedPaneId = activeTab?.focusedPaneId ?? null;

  // Ensure focusedPaneId is always a valid leaf pane in the active tab
  // This handles edge cases where focus is lost (null or stale)
  const validFocusedPaneId = useMemo(() => {
    if (!activeTab) return null;
    if (focusedPaneId) {
      const pane = activeTab.panes.get(focusedPaneId);
      if (pane && pane.type === "leaf") return focusedPaneId;
    }
    // Fallback: pick the first leaf pane
    const leaves = getLeafPaneIds(activeTab.panes, activeTab.rootPaneId);
    return leaves[0] ?? null;
  }, [activeTab, focusedPaneId]);

  // Helper to update a specific tab in the tabs array
  const updateTab = useCallback((tabId: string, updater: (tab: Tab) => Tab) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
  }, []);

  // ── Tab operations ──

  const createTab = useCallback(() => {
    const tabId = generateId("tab");
    const paneId = generateId("pane");
    const tab = createTabData(tabId, paneId);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tabId);
  }, [generateId]);

  const closeTab = useCallback(
    (tabId: string): { shouldCloseWindow: boolean; removedSessionIds: string[] } => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return { shouldCloseWindow: false, removedSessionIds: [] };

      // Collect all session IDs from this tab's panes for cleanup
      const removedSessionIds: string[] = [];
      for (const pane of tab.panes.values()) {
        if (pane.type === "leaf" && pane.sessionId) {
          removedSessionIds.push(pane.sessionId);
          removeSessionState(pane.sessionId);
        }
        if (pane.type === "leaf") {
          removePaneMapping(pane.id);
          removePaneSessionInitOptions(pane.id);
        }
      }

      const newTabs = tabs.filter((t) => t.id !== tabId);
      if (newTabs.length === 0) {
        return { shouldCloseWindow: true, removedSessionIds };
      }

      // Switch to adjacent tab
      const closedIndex = tabs.findIndex((t) => t.id === tabId);
      const newActiveIndex = Math.min(closedIndex, newTabs.length - 1);
      setTabs(newTabs);
      setActiveTabId(newTabs[newActiveIndex].id);
      return { shouldCloseWindow: false, removedSessionIds };
    },
    [tabs]
  );

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const switchTabByIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < tabs.length) {
        setActiveTabId(tabs[index].id);
      }
    },
    [tabs]
  );

  // ── Pane operations (scoped to active tab) ──

  const splitPane = useCallback(
    (paneId: string, direction: SplitDirection, keepSessionId?: string): string | null => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return null;

      const pane = tab.panes.get(paneId);
      if (!pane || pane.type !== "leaf") return null;

      const newPaneId = generateId("pane");
      const newSplitId = generateId("pane");
      const sessionIdToKeep = keepSessionId ?? pane.sessionId;

      const newPanes = splitPaneTree(
        tab.panes,
        paneId,
        direction,
        newPaneId,
        newSplitId,
        sessionIdToKeep
      );

      let newRootPaneId = tab.rootPaneId;
      if (paneId === tab.rootPaneId) {
        newRootPaneId = newSplitId;
      } else {
        const parentId = findParentPaneId(tab.panes, paneId, tab.rootPaneId);
        if (parentId) {
          const parent = newPanes.get(parentId);
          if (parent && parent.children) {
            parent.children = parent.children.map((id) => (id === paneId ? newSplitId : id));
          }
        }
      }

      updateTab(activeTabId, () => ({
        ...tab,
        rootPaneId: newRootPaneId,
        panes: newPanes,
        focusedPaneId: newPaneId,
      }));

      return newPaneId;
    },
    [tabs, activeTabId, generateId, updateTab]
  );

  const closePane = useCallback(
    (paneId: string): { removedSessionIds: string[]; shouldCloseWindow: boolean } => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return { removedSessionIds: [], shouldCloseWindow: false };

      const leafCount = getLeafPaneIds(tab.panes, tab.rootPaneId).length;

      // Single pane in tab: close the tab instead
      if (leafCount <= 1) {
        return closeTab(activeTabId);
      }

      // Snapshot DFS leaf order BEFORE removePaneFromTree, which mutates shared PaneNode objects
      const leavesBeforeClose = getLeafPaneIds(tab.panes, tab.rootPaneId);

      const result = removePaneFromTree(tab.panes, tab.rootPaneId, paneId);

      if (result.newRootId === "" && result.panes.size === 0) {
        return closeTab(activeTabId);
      }

      // Determine the best focus target after closing.
      const closedIndex = leavesBeforeClose.indexOf(paneId);
      const remainingLeaves = getLeafPaneIds(result.panes, result.newRootId);

      let newFocusedPaneId: string | null = null;
      // Walk backwards from closed pane to find the nearest surviving predecessor
      for (let i = closedIndex - 1; i >= 0; i--) {
        if (remainingLeaves.includes(leavesBeforeClose[i])) {
          newFocusedPaneId = leavesBeforeClose[i];
          break;
        }
      }
      if (!newFocusedPaneId) {
        newFocusedPaneId = remainingLeaves[0] ?? null;
      }

      updateTab(activeTabId, () => ({
        ...tab,
        rootPaneId: result.newRootId,
        panes: result.panes,
        focusedPaneId: newFocusedPaneId,
      }));

      result.removedSessionIds.forEach((sessionId) => removeSessionState(sessionId));
      removePaneMapping(paneId);
      removePaneSessionInitOptions(paneId);

      return {
        removedSessionIds: result.removedSessionIds,
        shouldCloseWindow: false,
      };
    },
    [tabs, activeTabId, closeTab, updateTab]
  );

  const focusPane = useCallback(
    (paneId: string | null) => {
      updateTab(activeTabId, (tab) => ({
        ...tab,
        focusedPaneId: paneId,
      }));
    },
    [activeTabId, updateTab]
  );

  const focusNextPane = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.focusedPaneId) return;
    const nextId = findAdjacentLeafPaneId(tab.panes, tab.rootPaneId, tab.focusedPaneId, "next");
    if (nextId) {
      updateTab(activeTabId, (t) => ({ ...t, focusedPaneId: nextId }));
    }
  }, [tabs, activeTabId, updateTab]);

  const focusPrevPane = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.focusedPaneId) return;
    const prevId = findAdjacentLeafPaneId(tab.panes, tab.rootPaneId, tab.focusedPaneId, "prev");
    if (prevId) {
      updateTab(activeTabId, (t) => ({ ...t, focusedPaneId: prevId }));
    }
  }, [tabs, activeTabId, updateTab]);

  const updateSplitRatio = useCallback(
    (paneId: string, ratio: number) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;

      const pane = tab.panes.get(paneId);
      if (!pane || pane.type !== "split") return;

      const clampedRatio = Math.max(0.1, Math.min(0.9, ratio));
      const newPanes = new Map(tab.panes);
      newPanes.set(paneId, { ...pane, splitRatio: clampedRatio });

      updateTab(activeTabId, (t) => ({ ...t, panes: newPanes }));
    },
    [tabs, activeTabId, updateTab]
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    switchTab,
    switchTabByIndex,
    focusedPaneId: validFocusedPaneId,
    splitPane,
    closePane,
    focusPane,
    focusNextPane,
    focusPrevPane,
    updateSplitRatio,
  };
}
