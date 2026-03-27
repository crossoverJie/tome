import { describe, expect, it } from "vitest";
import { createTab } from "../types/tab";
import {
  getDirectoryLabel,
  getTabCurrentDirectory,
  getTabDisplayTitle,
  getWindowTitle,
} from "./workdir";

describe("workdir helpers", () => {
  it("uses the last path segment for tab labels", () => {
    expect(getDirectoryLabel("/Users/chenjie/Documents/dev/github/tome")).toBe("tome");
    expect(getDirectoryLabel("/Users/chenjie/Documents/dev/github/tome/")).toBe("tome");
  });

  it("handles the root path and missing cwd", () => {
    expect(getDirectoryLabel("/")).toBe("/");
    expect(getDirectoryLabel(null)).toBe("Shell");
    expect(getWindowTitle("/tmp/project")).toBe("/tmp/project — Tome");
    expect(getWindowTitle(null)).toBe("Tome");
  });

  it("prefers the focused pane cwd for a tab title", () => {
    const tab = createTab("tab-1", "pane-1");
    const paneDirectoryMap = new Map<string, string | null>([["pane-1", "/tmp/project"]]);

    expect(getTabCurrentDirectory(tab, paneDirectoryMap)).toBe("/tmp/project");
    expect(getTabDisplayTitle(tab, paneDirectoryMap)).toBe("project");
  });

  it("falls back to the first leaf when the focused pane is missing", () => {
    const tab = createTab("tab-1", "pane-1");
    tab.focusedPaneId = "missing-pane";

    const paneDirectoryMap = new Map<string, string | null>([["pane-1", "/Users/demo/workspace"]]);

    expect(getTabCurrentDirectory(tab, paneDirectoryMap)).toBe("/Users/demo/workspace");
    expect(getTabDisplayTitle(tab, paneDirectoryMap)).toBe("workspace");
  });
});
