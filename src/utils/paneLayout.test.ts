import { describe, expect, it } from "vitest";
import { createLeafPane, createSplitPane, type PaneNode } from "../types/pane";
import { computePaneLayout } from "./paneLayout";

describe("computePaneLayout", () => {
  it("keeps leaf pane ids stable while mapping them into absolute bounds", () => {
    const panes = new Map<string, PaneNode>();
    panes.set("pane-a", createLeafPane("pane-a"));
    panes.set("pane-b", createLeafPane("pane-b"));
    panes.set("split-root", createSplitPane("split-root", "horizontal", ["pane-a", "pane-b"], 0.5));

    const layout = computePaneLayout(panes, "split-root");

    expect(layout.leaves).toEqual([
      { paneId: "pane-a", x: 0, y: 0, width: 0.5, height: 1 },
      { paneId: "pane-b", x: 0.5, y: 0, width: 0.5, height: 1 },
    ]);
    expect(layout.resizers).toEqual([
      {
        splitPaneId: "split-root",
        direction: "horizontal",
        x: 0.5,
        y: 0,
        width: 0,
        height: 1,
        containerWidth: 1,
        containerHeight: 1,
      },
    ]);
  });

  it("tracks nested split container bounds for ratio math", () => {
    const panes = new Map<string, PaneNode>();
    panes.set("pane-a", createLeafPane("pane-a"));
    panes.set("pane-b", createLeafPane("pane-b"));
    panes.set("pane-c", createLeafPane("pane-c"));
    panes.set(
      "split-inner",
      createSplitPane("split-inner", "vertical", ["pane-b", "pane-c"], 0.25)
    );
    panes.set(
      "split-root",
      createSplitPane("split-root", "horizontal", ["pane-a", "split-inner"], 0.6)
    );

    const layout = computePaneLayout(panes, "split-root");

    expect(layout.leaves).toEqual([
      { paneId: "pane-a", x: 0, y: 0, width: 0.6, height: 1 },
      { paneId: "pane-b", x: 0.6, y: 0, width: 0.4, height: 0.25 },
      { paneId: "pane-c", x: 0.6, y: 0.25, width: 0.4, height: 0.75 },
    ]);
    expect(layout.resizers).toEqual([
      {
        splitPaneId: "split-root",
        direction: "horizontal",
        x: 0.6,
        y: 0,
        width: 0,
        height: 1,
        containerWidth: 1,
        containerHeight: 1,
      },
      {
        splitPaneId: "split-inner",
        direction: "vertical",
        x: 0.6,
        y: 0.25,
        width: 0.4,
        height: 0,
        containerWidth: 0.4,
        containerHeight: 1,
      },
    ]);
  });
});
