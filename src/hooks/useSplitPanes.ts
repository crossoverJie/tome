import { useState, useCallback, useRef, useMemo } from "react";
import type { PaneNode, SplitDirection } from "../types/pane";
import {
  createLeafPane,
  splitPane as splitPaneTree,
  removePane as removePaneFromTree,
  findAdjacentLeafPaneId,
  findParentPaneId,
} from "../types/pane";

export interface UseSplitPanesReturn {
  rootPaneId: string;
  panes: Map<string, PaneNode>;
  focusedPaneId: string | null;
  splitPane: (paneId: string, direction: SplitDirection, keepSessionId?: string) => string | null;
  closePane: (paneId: string) => { removedSessionIds: string[]; shouldCloseWindow: boolean };
  focusPane: (paneId: string | null) => void;
  focusNextPane: () => void;
  focusPrevPane: () => void;
  updateSplitRatio: (paneId: string, ratio: number) => void;
  assignSessionToPane: (paneId: string, sessionId: string) => void;
  getPaneSessionId: (paneId: string) => string | undefined;
  getAllPaneIds: () => string[];
  getAllSessionIds: () => string[];
}

export function useSplitPanes(): UseSplitPanesReturn {
  // Generate unique IDs
  const idCounter = useRef(0);
  const generateId = useCallback(() => {
    return `pane-${++idCounter.current}-${Date.now()}`;
  }, []);

  // Initialize with single root pane
  const initialId = useMemo(() => {
    const id = generateId();
    return id;
  }, [generateId]);

  const [rootPaneId, setRootPaneId] = useState<string>(initialId);
  const [panes, setPanes] = useState<Map<string, PaneNode>>(() => {
    const map = new Map<string, PaneNode>();
    map.set(initialId, createLeafPane(initialId));
    return map;
  });
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(initialId);

  // Split a pane into two
  const splitPane = useCallback(
    (paneId: string, direction: SplitDirection, keepSessionId?: string): string | null => {
      const pane = panes.get(paneId);
      if (!pane || pane.type !== "leaf") return null;

      const newPaneId = generateId();
      const newSplitId = generateId();

      // Get the current pane's sessionId to keep it in the first child
      // Use provided keepSessionId if available, otherwise use the pane's existing sessionId
      const sessionIdToKeep = keepSessionId ?? pane.sessionId;

      const newPanes = splitPaneTree(
        panes,
        paneId,
        direction,
        newPaneId,
        newSplitId,
        sessionIdToKeep
      );

      setPanes(newPanes);

      // If splitting root, update root
      if (paneId === rootPaneId) {
        setRootPaneId(newSplitId);
      } else {
        // Update parent's children reference
        const parentId = findParentPaneId(panes, paneId, rootPaneId);
        if (parentId) {
          const parent = newPanes.get(parentId);
          if (parent && parent.children) {
            parent.children = parent.children.map((id) => (id === paneId ? newSplitId : id));
          }
        }
      }

      // Focus the new pane
      setFocusedPaneId(newPaneId);

      return newPaneId;
    },
    [panes, rootPaneId, generateId]
  );

  // Close a pane
  const closePane = useCallback(
    (paneId: string): { removedSessionIds: string[]; shouldCloseWindow: boolean } => {
      // Don't close if it's the only pane
      const leafCount = getAllLeafPaneIds().length;
      if (leafCount <= 1 && paneId === focusedPaneId) {
        const sessionId = panes.get(paneId)?.sessionId;
        return {
          removedSessionIds: sessionId ? [sessionId] : [],
          shouldCloseWindow: true,
        };
      }

      const result = removePaneFromTree(panes, rootPaneId, paneId);

      if (result.newRootId === "" && result.panes.size === 0) {
        // All panes closed
        return {
          removedSessionIds: result.removedSessionIds,
          shouldCloseWindow: true,
        };
      }

      setPanes(result.panes);
      setRootPaneId(result.newRootId);

      // Update focus to adjacent pane
      if (focusedPaneId === paneId) {
        const adjacentId = findAdjacentLeafPaneId(result.panes, result.newRootId, paneId, "next");
        setFocusedPaneId(adjacentId);
      }

      return {
        removedSessionIds: result.removedSessionIds,
        shouldCloseWindow: false,
      };
    },
    [panes, rootPaneId, focusedPaneId]
  );

  // Focus a specific pane
  const focusPane = useCallback((paneId: string | null) => {
    setFocusedPaneId(paneId);
  }, []);

  // Focus next pane (cyclic)
  const focusNextPane = useCallback(() => {
    if (!focusedPaneId || !rootPaneId) return;
    const nextId = findAdjacentLeafPaneId(panes, rootPaneId, focusedPaneId, "next");
    if (nextId) setFocusedPaneId(nextId);
  }, [panes, rootPaneId, focusedPaneId]);

  // Focus previous pane (cyclic)
  const focusPrevPane = useCallback(() => {
    if (!focusedPaneId || !rootPaneId) return;
    const prevId = findAdjacentLeafPaneId(panes, rootPaneId, focusedPaneId, "prev");
    if (prevId) setFocusedPaneId(prevId);
  }, [panes, rootPaneId, focusedPaneId]);

  // Update split ratio for a split pane
  const updateSplitRatio = useCallback(
    (paneId: string, ratio: number) => {
      const pane = panes.get(paneId);
      if (!pane || pane.type !== "split") return;

      // Clamp ratio between 0.1 and 0.9
      const clampedRatio = Math.max(0.1, Math.min(0.9, ratio));

      const newPanes = new Map(panes);
      newPanes.set(paneId, { ...pane, splitRatio: clampedRatio });
      setPanes(newPanes);
    },
    [panes]
  );

  // Assign session to a pane
  const assignSessionToPane = useCallback(
    (paneId: string, sessionId: string) => {
      const pane = panes.get(paneId);
      if (!pane || pane.type !== "leaf") return;

      const newPanes = new Map(panes);
      newPanes.set(paneId, { ...pane, sessionId });
      setPanes(newPanes);
    },
    [panes]
  );

  // Get session ID for a pane
  const getPaneSessionId = useCallback(
    (paneId: string): string | undefined => {
      const pane = panes.get(paneId);
      return pane?.type === "leaf" ? pane.sessionId : undefined;
    },
    [panes]
  );

  // Get all pane IDs
  const getAllPaneIds = useCallback((): string[] => {
    return Array.from(panes.keys());
  }, [panes]);

  // Get all leaf pane IDs
  const getAllLeafPaneIds = useCallback((): string[] => {
    const result: string[] = [];
    function collectLeafIds(id: string) {
      const pane = panes.get(id);
      if (!pane) return;
      if (pane.type === "leaf") {
        result.push(id);
      } else if (pane.children) {
        for (const childId of pane.children) {
          collectLeafIds(childId);
        }
      }
    }
    if (rootPaneId) {
      collectLeafIds(rootPaneId);
    }
    return result;
  }, [panes, rootPaneId]);

  // Get all session IDs
  const getAllSessionIds = useCallback((): string[] => {
    const sessionIds: string[] = [];
    for (const pane of panes.values()) {
      if (pane.type === "leaf" && pane.sessionId) {
        sessionIds.push(pane.sessionId);
      }
    }
    return sessionIds;
  }, [panes]);

  return {
    rootPaneId,
    panes,
    focusedPaneId,
    splitPane,
    closePane,
    focusPane,
    focusNextPane,
    focusPrevPane,
    updateSplitRatio,
    assignSessionToPane,
    getPaneSessionId,
    getAllPaneIds,
    getAllSessionIds,
  };
}
