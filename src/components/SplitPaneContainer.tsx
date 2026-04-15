import { useCallback, useMemo, useRef } from "react";
import type { PaneNode } from "../types/pane";
import { PaneView } from "./PaneView";
import { Resizer } from "./Resizer";
import { computePaneLayout } from "../utils/paneLayout";
import type { AiAgentKind } from "../utils/fullscreenSessionState";

interface SplitPaneContainerProps {
  paneId: string;
  panes: Map<string, PaneNode>;
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onUpdateSplitRatio: (paneId: string, ratio: number) => void;
  onWorkingDirectoryChange: (paneId: string, currentDirectory: string | null) => void;
  onAgentStateChange?: (paneId: string, aiAgentKind: AiAgentKind, isActive: boolean) => void;
  onOpenPathInNewTab: (cwd: string) => void;
  style?: React.CSSProperties;
}

export function SplitPaneContainer({
  paneId,
  panes,
  focusedPaneId,
  onFocusPane,
  onUpdateSplitRatio,
  onWorkingDirectoryChange,
  onAgentStateChange,
  onOpenPathInNewTab,
  style,
}: SplitPaneContainerProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const resizerLayerRefs = useRef(new Map<string, HTMLDivElement>());
  const layout = useMemo(() => computePaneLayout(panes, paneId), [panes, paneId]);

  // Handle resize by calculating new ratio based on delta
  const handleResize = useCallback(
    (splitPaneId: string, axis: "width" | "height", delta: number) => {
      const splitPane = panes.get(splitPaneId);
      if (!splitPane || splitPane.type !== "split") {
        return;
      }

      const container = resizerLayerRefs.current.get(splitPaneId);
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const containerSize = axis === "width" ? rect.width : rect.height;

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
              onAgentStateChange={onAgentStateChange}
              onOpenPathInNewTab={onOpenPathInNewTab}
            />
          </div>
        );
      })}
      {layout.resizers.map((resizer) => (
        <div
          key={resizer.splitPaneId}
          className={`split-resizer-layer ${resizer.direction}`}
          ref={(node) => {
            if (node) {
              resizerLayerRefs.current.set(resizer.splitPaneId, node);
            } else {
              resizerLayerRefs.current.delete(resizer.splitPaneId);
            }
          }}
          style={
            resizer.direction === "horizontal"
              ? {
                  left: `${resizer.containerX * 100}%`,
                  top: `${resizer.containerY * 100}%`,
                  width: `${resizer.containerWidth * 100}%`,
                  height: `${resizer.containerHeight * 100}%`,
                }
              : {
                  left: `${resizer.containerX * 100}%`,
                  top: `${resizer.containerY * 100}%`,
                  width: `${resizer.containerWidth * 100}%`,
                  height: `${resizer.containerHeight * 100}%`,
                }
          }
        >
          <div
            className={`split-resizer-handle ${resizer.direction}`}
            style={
              resizer.direction === "horizontal"
                ? {
                    left: `calc(${(resizer.handleOffset / resizer.containerWidth) * 100}% - 2px)`,
                    top: 0,
                    width: "4px",
                    height: "100%",
                  }
                : {
                    left: 0,
                    top: `calc(${(resizer.handleOffset / resizer.containerHeight) * 100}% - 2px)`,
                    width: "100%",
                    height: "4px",
                  }
            }
          >
            <Resizer
              direction={resizer.direction}
              onResize={(delta) =>
                handleResize(
                  resizer.splitPaneId,
                  resizer.direction === "horizontal" ? "width" : "height",
                  delta
                )
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}
