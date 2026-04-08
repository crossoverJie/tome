import { memo, useCallback } from "react";
import type { Tab } from "../types/tab";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSwitchTab: (tabId: string) => void;
  onCreateTab: () => void;
  onCloseTab: (tabId: string) => void;
  busyTabs?: Map<string, string | null>; // tabId -> command or null
}

export const TabBar = memo(function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCreateTab,
  onCloseTab,
  busyTabs,
}: TabBarProps) {
  // Only show tab bar when there are multiple tabs
  if (tabs.length <= 1) return null;

  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      onCloseTab(tabId);
    },
    [onCloseTab]
  );

  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => {
        const busyCommand = busyTabs?.get(tab.id);
        const isBusy = busyCommand !== undefined && busyCommand !== null;
        return (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "active" : ""} ${isBusy ? "busy" : ""}`}
            onClick={() => onSwitchTab(tab.id)}
          >
            <span className="tab-title">
              {isBusy ? `● ${busyCommand}` : `${tab.title} ${index + 1}`}
            </span>
            <button
              className="tab-close"
              onClick={(e) => handleClose(e, tab.id)}
              aria-label="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="tab-new" onClick={onCreateTab} aria-label="New tab">
        +
      </div>
    </div>
  );
});
