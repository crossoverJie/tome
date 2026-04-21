import { memo, useCallback } from "react";
import type { Tab } from "../types/tab";
import type { TabPresentation } from "../utils/agentStatus";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSwitchTab: (tabId: string) => void;
  onCreateTab: () => void;
  onCloseTab: (tabId: string) => void;
  tabPresentations?: Map<string, TabPresentation>; // tabId -> presentation (label, tooltip)
}

export const TabBar = memo(function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCreateTab,
  onCloseTab,
  tabPresentations,
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
        const presentation = tabPresentations?.get(tab.id);
        const displayLabel = presentation?.label ?? tab.title;
        const tooltip = presentation?.tooltip ?? tab.title;
        return (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}
            onClick={() => onSwitchTab(tab.id)}
            title={tooltip}
          >
            <span className="tab-title">{displayLabel}</span>
            {index < 9 && <span className="tab-shortcut">⌘{index + 1}</span>}
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
