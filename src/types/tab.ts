import type { PaneNode } from "./pane";
import { createLeafPane } from "./pane";

export interface Tab {
  id: string;
  title: string;
  rootPaneId: string;
  panes: Map<string, PaneNode>;
  focusedPaneId: string | null;
  busyCommand?: string | null;
  gitBranch?: string | null;
}

export function createTab(tabId: string, paneId: string): Tab {
  const panes = new Map<string, PaneNode>();
  panes.set(paneId, createLeafPane(paneId));
  return {
    id: tabId,
    title: "Shell",
    rootPaneId: paneId,
    panes,
    focusedPaneId: paneId,
  };
}
