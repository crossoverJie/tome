import { getLeafPaneIds } from "../types/pane";
import type { Tab } from "../types/tab";

export function getDirectoryLabel(path: string | null | undefined): string {
  if (!path) return "Shell";

  const normalizedPath = path === "/" ? path : path.replace(/\/+$/, "");
  if (normalizedPath === "/") return "/";

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalizedPath;
}

export function getWindowTitle(path: string | null | undefined): string {
  return path ? `${path} — Tome` : "Tome";
}

export function getTabCurrentDirectory(
  tab: Tab,
  paneDirectoryMap: Map<string, string | null>
): string | null {
  if (tab.focusedPaneId) {
    const focusedPane = tab.panes.get(tab.focusedPaneId);
    if (focusedPane?.type === "leaf") {
      return paneDirectoryMap.get(tab.focusedPaneId) ?? null;
    }
  }

  const fallbackPaneId = getLeafPaneIds(tab.panes, tab.rootPaneId)[0];
  return fallbackPaneId ? (paneDirectoryMap.get(fallbackPaneId) ?? null) : null;
}

export function getTabDisplayTitle(tab: Tab, paneDirectoryMap: Map<string, string | null>): string {
  return getDirectoryLabel(getTabCurrentDirectory(tab, paneDirectoryMap));
}
