import * as React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitPaneContainer } from "./SplitPaneContainer";
import { createLeafPane, createSplitPane, type PaneNode } from "../types/pane";

const lifecycle = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>(),
}));

vi.mock("./PaneView", () => ({
  PaneView: ({ paneId }: { paneId: string }) => {
    React.useEffect(() => {
      lifecycle.mounts.set(paneId, (lifecycle.mounts.get(paneId) ?? 0) + 1);
      return () => {
        lifecycle.unmounts.set(paneId, (lifecycle.unmounts.get(paneId) ?? 0) + 1);
      };
    }, [paneId]);

    return <div data-testid={`pane-${paneId}`}>{paneId}</div>;
  },
}));

vi.mock("./Resizer", () => ({
  Resizer: () => <div data-testid="resizer" />,
}));

describe("SplitPaneContainer", () => {
  beforeEach(() => {
    lifecycle.mounts.clear();
    lifecycle.unmounts.clear();
  });

  it("keeps an existing leaf pane mounted when a split adds a sibling", () => {
    const initialPanes = new Map<string, PaneNode>([["pane-a", createLeafPane("pane-a")]]);

    const { rerender } = render(
      <SplitPaneContainer
        paneId="pane-a"
        panes={initialPanes}
        focusedPaneId="pane-a"
        onFocusPane={() => {}}
        onUpdateSplitRatio={() => {}}
        onWorkingDirectoryChange={() => {}}
      />
    );

    expect(lifecycle.mounts.get("pane-a")).toBe(1);
    expect(lifecycle.unmounts.get("pane-a") ?? 0).toBe(0);

    const splitPanes = new Map<string, PaneNode>([
      ["pane-a", createLeafPane("pane-a")],
      ["pane-b", createLeafPane("pane-b")],
      ["split-root", createSplitPane("split-root", "horizontal", ["pane-a", "pane-b"], 0.5)],
    ]);

    rerender(
      <SplitPaneContainer
        paneId="split-root"
        panes={splitPanes}
        focusedPaneId="pane-b"
        onFocusPane={() => {}}
        onUpdateSplitRatio={() => {}}
        onWorkingDirectoryChange={() => {}}
      />
    );

    expect(lifecycle.mounts.get("pane-a")).toBe(1);
    expect(lifecycle.unmounts.get("pane-a") ?? 0).toBe(0);
    expect(lifecycle.mounts.get("pane-b")).toBe(1);
  });
});
