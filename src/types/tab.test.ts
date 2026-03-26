import { describe, it, expect } from "vitest";
import { createTab } from "./tab";

describe("createTab", () => {
  it("creates a tab with one leaf pane", () => {
    const tab = createTab("tab-1", "pane-1");
    expect(tab.id).toBe("tab-1");
    expect(tab.title).toBe("Shell");
    expect(tab.rootPaneId).toBe("pane-1");
    expect(tab.focusedPaneId).toBe("pane-1");
    expect(tab.panes.size).toBe(1);
  });

  it("creates a leaf pane node in the panes map", () => {
    const tab = createTab("tab-1", "pane-1");
    const pane = tab.panes.get("pane-1");
    expect(pane).toBeDefined();
    expect(pane!.type).toBe("leaf");
    expect(pane!.id).toBe("pane-1");
    expect(pane!.sessionId).toBeUndefined();
  });

  it("creates independent tabs with separate pane maps", () => {
    const tab1 = createTab("tab-1", "pane-1");
    const tab2 = createTab("tab-2", "pane-2");
    expect(tab1.panes).not.toBe(tab2.panes);
    expect(tab1.panes.has("pane-2")).toBe(false);
    expect(tab2.panes.has("pane-1")).toBe(false);
  });
});
