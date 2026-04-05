import { useCallback, useMemo, useRef } from "react";
import type { PaneNode } from "../types/pane";
import { PaneView } from "./PaneView";
import { Resizer } from "./Resizer";
import { computePaneLayout } from "../utils/paneLayout";

interface SplitPaneContainerProps {
  paneId: string;
  panes: Map<string, PaneNode>;
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onUpdateSplitRatio: (paneId: string, ratio: number) => void;
  onWorkingDirectoryChange: (paneId: string, currentDirectory: string | null) => void;
  style?: React.CSSProperties;
}

export function SplitPaneContainer({
  paneId,
  panes,
  focusedPaneId,
  onFocusPane,
  onUpdateSplitRatio,
  onWorkingDirectoryChange,
  style,
}: SplitPaneContainerProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => computePaneLayout(panes, paneId), [panes, paneId]);

  // Handle resize by calculating new ratio based on delta
  const handleResize = useCallback(
    (splitPaneId: string, containerFraction: number, axis: "width" | "height", delta: number) => {
      const splitPane = panes.get(splitPaneId);
      if (!splitPane || splitPane.type !== "split") {
        return;
      }

      const container = paneRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const rootSize = axis === "width" ? rect.width : rect.height;
      const containerSize = rootSize * containerFraction;

      if (containerSize === 0) return;

      const ratioDelta = delta / containerSize;
      const currentRatio = splitPane.splitRatio ?? 0.5;
      onUpdateSplitRatio(splitPaneId, currentRatio + ratioDelta);
    },
    [onUpdateSplitRatio, panes]
  );

  return (
    <div ref={paneRef} className="split-layout" style={style}>
      {layout.leaves.map((leaf) => {
        const pane = panes.get(leaf.paneId);
        if (!pane || pane.type !== "leaf") {
          return null;
        }

        return (
          <div
            key={leaf.paneId}
            className="split-pane split-pane-absolute"
            style={{
              left: `${leaf.x * 100}%`,
              top: `${leaf.y * 100}%`,
              width: `${leaf.width * 100}%`,
              height: `${leaf.height * 100}%`,
            }}
          >
            <PaneView
              paneId={leaf.paneId}
              sessionId={pane.sessionId}
              isFocused={focusedPaneId === leaf.paneId}
              onFocus={() => onFocusPane(leaf.paneId)}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
            />
          </div>
        );
      })}
      {layout.resizers.map((resizer) => (
        <div
          key={resizer.splitPaneId}
          className={`split-resizer-layer ${resizer.direction}`}
          style={
            resizer.direction === "horizontal"
              ? {
                  left: `calc(${resizer.x * 100}% - 2px)`,
                  top: `${resizer.y * 100}%`,
                  width: "4px",
                  height: `${resizer.height * 100}%`,
                }
              : {
                  left: `${resizer.x * 100}%`,
                  top: `calc(${resizer.y * 100}% - 2px)`,
                  width: `${resizer.width * 100}%`,
                  height: "4px",
                }
          }
        >
          <Resizer
            direction={resizer.direction}
            onResize={(delta) =>
              handleResize(
                resizer.splitPaneId,
                resizer.direction === "horizontal"
                  ? resizer.containerWidth
                  : resizer.containerHeight,
                resizer.direction === "horizontal" ? "width" : "height",
                delta
              )
            }
          />
        </div>
      ))}
    </div>
  );
}
