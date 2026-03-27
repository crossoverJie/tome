import { useCallback, useRef } from "react";
import type { PaneNode, SplitDirection } from "../types/pane";
import { PaneView } from "./PaneView";
import { Resizer } from "./Resizer";

interface SplitPaneContainerProps {
  paneId: string;
  panes: Map<string, PaneNode>;
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onUpdateSplitRatio: (paneId: string, ratio: number) => void;
  onWorkingDirectoryChange: (paneId: string, currentDirectory: string | null) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
}

export function SplitPaneContainer({
  paneId,
  panes,
  focusedPaneId,
  onFocusPane,
  onUpdateSplitRatio,
  onWorkingDirectoryChange,
  containerRef,
  style,
}: SplitPaneContainerProps) {
  const pane = panes.get(paneId);
  const paneRef = useRef<HTMLDivElement>(null);

  if (!pane) return null;

  // Handle resize by calculating new ratio based on delta
  const handleResize = useCallback(
    (splitPaneId: string, direction: SplitDirection, delta: number) => {
      const splitPane = panes.get(splitPaneId);
      if (!splitPane || splitPane.type !== "split") return;

      const container = paneRef.current;
      if (!container) return;

      // Get container dimensions
      const rect = container.getBoundingClientRect();
      const containerSize = direction === "horizontal" ? rect.width : rect.height;

      if (containerSize === 0) return;

      // Convert pixel delta to ratio delta
      const ratioDelta = delta / containerSize;
      const currentRatio = splitPane.splitRatio ?? 0.5;
      const newRatio = currentRatio + ratioDelta;

      onUpdateSplitRatio(splitPaneId, newRatio);
    },
    [panes, onUpdateSplitRatio]
  );

  // Render leaf pane
  if (pane.type === "leaf") {
    return (
      <div ref={paneRef} className="split-pane" style={style}>
        <PaneView
          paneId={paneId}
          sessionId={pane.sessionId}
          isFocused={focusedPaneId === paneId}
          onFocus={() => onFocusPane(paneId)}
          onWorkingDirectoryChange={onWorkingDirectoryChange}
        />
      </div>
    );
  }

  // Render split container
  const { direction, children, splitRatio = 0.5 } = pane;

  if (!children || children.length !== 2 || !direction) {
    return null;
  }

  const [firstChildId, secondChildId] = children;

  // Calculate flex styles based on split ratio
  const firstFlex = splitRatio;
  const secondFlex = 1 - splitRatio;

  return (
    <div ref={paneRef} className={`split-container ${direction}`} style={style}>
      <SplitPaneContainer
        paneId={firstChildId}
        panes={panes}
        focusedPaneId={focusedPaneId}
        onFocusPane={onFocusPane}
        onUpdateSplitRatio={onUpdateSplitRatio}
        onWorkingDirectoryChange={onWorkingDirectoryChange}
        containerRef={containerRef}
        style={{ flex: firstFlex }}
      />
      <Resizer direction={direction} onResize={(delta) => handleResize(paneId, direction, delta)} />
      <SplitPaneContainer
        paneId={secondChildId}
        panes={panes}
        focusedPaneId={focusedPaneId}
        onFocusPane={onFocusPane}
        onUpdateSplitRatio={onUpdateSplitRatio}
        onWorkingDirectoryChange={onWorkingDirectoryChange}
        containerRef={containerRef}
        style={{ flex: secondFlex }}
      />
    </div>
  );
}
