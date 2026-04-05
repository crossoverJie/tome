import type { PaneNode, SplitDirection } from "../types/pane";

export interface PaneLeafLayout {
  paneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneResizerLayout {
  splitPaneId: string;
  direction: SplitDirection;
  containerX: number;
  containerY: number;
  containerWidth: number;
  containerHeight: number;
  handleOffset: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneLayoutResult {
  leaves: PaneLeafLayout[];
  resizers: PaneResizerLayout[];
}

interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computePaneLayout(
  panes: Map<string, PaneNode>,
  rootPaneId: string
): PaneLayoutResult {
  const leaves: PaneLeafLayout[] = [];
  const resizers: PaneResizerLayout[] = [];

  function walk(paneId: string, bounds: LayoutBounds): void {
    const pane = panes.get(paneId);
    if (!pane) {
      return;
    }

    if (pane.type === "leaf") {
      leaves.push({
        paneId,
        ...bounds,
      });
      return;
    }

    if (!pane.children || pane.children.length !== 2 || !pane.direction) {
      return;
    }

    const [firstChildId, secondChildId] = pane.children;
    const ratio = pane.splitRatio ?? 0.5;

    if (pane.direction === "horizontal") {
      const firstWidth = bounds.width * ratio;
      const secondWidth = bounds.width - firstWidth;

      resizers.push({
        splitPaneId: paneId,
        direction: "horizontal",
        containerX: bounds.x,
        containerY: bounds.y,
        containerWidth: bounds.width,
        containerHeight: bounds.height,
        handleOffset: firstWidth,
        x: bounds.x + firstWidth,
        y: bounds.y,
        width: 0,
        height: bounds.height,
      });

      walk(firstChildId, {
        x: bounds.x,
        y: bounds.y,
        width: firstWidth,
        height: bounds.height,
      });
      walk(secondChildId, {
        x: bounds.x + firstWidth,
        y: bounds.y,
        width: secondWidth,
        height: bounds.height,
      });
      return;
    }

    const firstHeight = bounds.height * ratio;
    const secondHeight = bounds.height - firstHeight;

    resizers.push({
      splitPaneId: paneId,
      direction: "vertical",
      containerX: bounds.x,
      containerY: bounds.y,
      containerWidth: bounds.width,
      containerHeight: bounds.height,
      handleOffset: firstHeight,
      x: bounds.x,
      y: bounds.y + firstHeight,
      width: bounds.width,
      height: 0,
    });

    walk(firstChildId, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: firstHeight,
    });
    walk(secondChildId, {
      x: bounds.x,
      y: bounds.y + firstHeight,
      width: bounds.width,
      height: secondHeight,
    });
  }

  walk(rootPaneId, { x: 0, y: 0, width: 1, height: 1 });

  return { leaves, resizers };
}
