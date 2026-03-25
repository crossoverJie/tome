export type SplitDirection = "horizontal" | "vertical";

export interface PaneNode {
  id: string;
  type: "leaf" | "split";
  // for leaf nodes
  sessionId?: string;
  // for split nodes
  direction?: SplitDirection;
  children?: string[]; // child pane IDs
  splitRatio?: number; // 0-1 for first child, second child gets 1-ratio
}

export interface PaneState {
  rootPaneId: string;
  panes: Map<string, PaneNode>;
  focusedPaneId: string | null;
}

// Helper functions for pane tree operations

export function createLeafPane(id: string, sessionId?: string): PaneNode {
  return {
    id,
    type: "leaf",
    sessionId,
  };
}

export function createSplitPane(
  id: string,
  direction: SplitDirection,
  children: string[],
  splitRatio = 0.5
): PaneNode {
  return {
    id,
    type: "split",
    direction,
    children,
    splitRatio,
  };
}

// Get all leaf pane IDs in DFS order
export function getLeafPaneIds(panes: Map<string, PaneNode>, rootId: string): string[] {
  const result: string[] = [];
  const node = panes.get(rootId);
  if (!node) return result;

  if (node.type === "leaf") {
    result.push(rootId);
  } else if (node.children) {
    for (const childId of node.children) {
      result.push(...getLeafPaneIds(panes, childId));
    }
  }

  return result;
}

// Find parent pane ID of a given pane
export function findParentPaneId(
  panes: Map<string, PaneNode>,
  targetId: string,
  rootId: string
): string | null {
  const node = panes.get(rootId);
  if (!node || node.type === "leaf") return null;

  if (node.children?.includes(targetId)) {
    return rootId;
  }

  for (const childId of node.children || []) {
    const parentId = findParentPaneId(panes, targetId, childId);
    if (parentId) return parentId;
  }

  return null;
}

// Get sibling pane ID (for a leaf child in a split)
export function getSiblingPaneId(panes: Map<string, PaneNode>, paneId: string): string | null {
  const parentId = findParentPaneId(panes, paneId, panes.get(paneId)?.id || "");
  if (!parentId) return null;

  const parent = panes.get(parentId);
  if (!parent || parent.type !== "split" || !parent.children) return null;

  return parent.children.find((id) => id !== paneId) || null;
}

// Split a leaf pane into two
export function splitPane(
  panes: Map<string, PaneNode>,
  paneId: string,
  direction: SplitDirection,
  newPaneId: string,
  newSplitId: string,
  keepSessionId?: string
): Map<string, PaneNode> {
  const newPanes = new Map(panes);
  const pane = newPanes.get(paneId);

  if (!pane || pane.type !== "leaf") return newPanes;

  // Create new leaf pane
  const newLeaf = createLeafPane(newPaneId);

  // Convert original pane to a split
  const splitPane = createSplitPane(newSplitId, direction, [paneId, newPaneId], 0.5);

  // Update original pane - transfer session to first child if keeping it
  const originalPane = createLeafPane(paneId, keepSessionId);

  newPanes.set(paneId, originalPane);
  newPanes.set(newPaneId, newLeaf);
  newPanes.set(newSplitId, splitPane);

  return newPanes;
}

// Remove a pane and clean up parent if needed
export function removePane(
  panes: Map<string, PaneNode>,
  rootId: string,
  paneId: string
): { panes: Map<string, PaneNode>; newRootId: string; removedSessionIds: string[] } {
  const newPanes = new Map(panes);
  const removedSessionIds: string[] = [];

  const pane = newPanes.get(paneId);
  if (!pane) return { panes: newPanes, newRootId: rootId, removedSessionIds };

  // Collect all session IDs that will be removed
  function collectSessionIds(id: string) {
    const node = newPanes.get(id);
    if (!node) return;
    if (node.type === "leaf" && node.sessionId) {
      removedSessionIds.push(node.sessionId);
    } else if (node.children) {
      for (const childId of node.children) {
        collectSessionIds(childId);
      }
    }
  }
  collectSessionIds(paneId);

  // Find parent
  const parentId = findParentPaneId(newPanes, paneId, rootId);

  if (!parentId) {
    // This is the root pane - can't remove unless we want to close the window
    // Return empty state to signal window should close
    if (paneId === rootId) {
      return { panes: new Map(), newRootId: "", removedSessionIds };
    }
    return { panes: newPanes, newRootId: rootId, removedSessionIds };
  }

  const parent = newPanes.get(parentId);
  if (!parent || parent.type !== "split" || !parent.children) {
    return { panes: newPanes, newRootId: rootId, removedSessionIds };
  }

  // Get the sibling that will replace the parent
  const siblingId = parent.children.find((id) => id !== paneId);
  if (!siblingId) {
    return { panes: newPanes, newRootId: rootId, removedSessionIds };
  }

  // Remove pane and its subtree
  function removeSubtree(id: string) {
    const node = newPanes.get(id);
    if (!node) return;
    newPanes.delete(id);
    if (node.children) {
      for (const childId of node.children) {
        removeSubtree(childId);
      }
    }
  }
  removeSubtree(paneId);

  // Promote sibling to replace parent
  const sibling = newPanes.get(siblingId);
  if (!sibling) {
    return { panes: newPanes, newRootId: rootId, removedSessionIds };
  }

  if (parentId === rootId) {
    // Parent is root, sibling becomes new root
    newPanes.delete(parentId);
    return { panes: newPanes, newRootId: siblingId, removedSessionIds };
  }

  // Replace parent reference in grandparent
  const grandparentId = findParentPaneId(newPanes, parentId, rootId);
  if (grandparentId) {
    const grandparent = newPanes.get(grandparentId);
    if (grandparent && grandparent.children) {
      grandparent.children = grandparent.children.map((id) => (id === parentId ? siblingId : id));
    }
  }

  newPanes.delete(parentId);
  return { panes: newPanes, newRootId: rootId, removedSessionIds };
}

// Find next/previous leaf pane in DFS order
export function findAdjacentLeafPaneId(
  panes: Map<string, PaneNode>,
  rootId: string,
  currentId: string,
  direction: "next" | "prev"
): string | null {
  const leafIds = getLeafPaneIds(panes, rootId);
  const currentIndex = leafIds.indexOf(currentId);

  if (currentIndex === -1) return null;

  if (direction === "next") {
    return leafIds[(currentIndex + 1) % leafIds.length];
  } else {
    return leafIds[(currentIndex - 1 + leafIds.length) % leafIds.length];
  }
}
