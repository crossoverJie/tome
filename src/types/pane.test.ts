import { describe, expect, it } from "vitest";
import { createLeafPane, splitPane } from "./pane";

describe("splitPane", () => {
  it("keeps the original session on the existing pane and leaves the new pane unbound", () => {
    const panes = new Map([["pane-1", createLeafPane("pane-1", "session-1")]]);

    const nextPanes = splitPane(panes, "pane-1", "horizontal", "pane-2", "split-1", "session-1");

    expect(nextPanes.get("pane-1")).toEqual({
      id: "pane-1",
      type: "leaf",
      sessionId: "session-1",
    });
    expect(nextPanes.get("pane-2")).toEqual({
      id: "pane-2",
      type: "leaf",
      sessionId: undefined,
    });
    expect(nextPanes.get("split-1")).toEqual({
      id: "split-1",
      type: "split",
      direction: "horizontal",
      children: ["pane-1", "pane-2"],
      splitRatio: 0.5,
    });
  });
});
