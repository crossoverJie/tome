import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabs } from "./useTabs";
import { getLeafPaneIds } from "../types/pane";

describe("useTabs", () => {
  it("initializes with one tab and one focused pane", () => {
    const { result } = renderHook(() => useTabs());
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.focusedPaneId).not.toBeNull();
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  describe("split pane close order (regression: must be 3→2→1, not 3→1→2)", () => {
    it("closing C focuses B, then closing B focuses A", () => {
      const { result } = renderHook(() => useTabs());

      // Get initial pane A
      const paneA = result.current.focusedPaneId!;
      expect(paneA).not.toBeNull();

      // Split A → creates B, focus moves to B
      let paneB: string | null = null;
      act(() => {
        paneB = result.current.splitPane(paneA, "horizontal");
      });
      expect(paneB).not.toBeNull();
      expect(result.current.focusedPaneId).toBe(paneB);

      // Split B → creates C, focus moves to C
      let paneC: string | null = null;
      act(() => {
        paneC = result.current.splitPane(paneB!, "horizontal");
      });
      expect(paneC).not.toBeNull();
      expect(result.current.focusedPaneId).toBe(paneC);

      // Verify DFS order is [A, B, C]
      const tab = result.current.activeTab;
      const leaves = getLeafPaneIds(tab.panes, tab.rootPaneId);
      expect(leaves).toEqual([paneA, paneB, paneC]);

      // Close C → should focus B (predecessor), NOT A
      act(() => {
        result.current.closePane(paneC!);
      });
      expect(result.current.focusedPaneId).toBe(paneB);

      // Close B → should focus A
      act(() => {
        result.current.closePane(paneB!);
      });
      expect(result.current.focusedPaneId).toBe(paneA);
    });

    it("closing B (middle) focuses A when A,B,C exist and B is focused", () => {
      const { result } = renderHook(() => useTabs());

      const paneA = result.current.focusedPaneId!;

      let paneB: string | null = null;
      act(() => {
        paneB = result.current.splitPane(paneA, "horizontal");
      });

      let paneC: string | null = null;
      act(() => {
        paneC = result.current.splitPane(paneB!, "horizontal");
      });

      // Focus B manually
      act(() => {
        result.current.focusPane(paneB);
      });
      expect(result.current.focusedPaneId).toBe(paneB);

      // Close B → should focus A (predecessor of B)
      act(() => {
        result.current.closePane(paneB!);
      });
      expect(result.current.focusedPaneId).toBe(paneA);

      // C should still exist
      const leaves = getLeafPaneIds(
        result.current.activeTab.panes,
        result.current.activeTab.rootPaneId
      );
      expect(leaves).toContain(paneA);
      expect(leaves).toContain(paneC);
      expect(leaves).not.toContain(paneB);
    });
  });

  describe("close last pane signals window close", () => {
    it("returns shouldCloseWindow when closing the only pane", () => {
      const { result } = renderHook(() => useTabs());
      const paneA = result.current.focusedPaneId!;

      let closeResult: { shouldCloseWindow: boolean } | undefined;
      act(() => {
        closeResult = result.current.closePane(paneA);
      });
      expect(closeResult!.shouldCloseWindow).toBe(true);
    });
  });

  describe("split then close single pane focuses correctly", () => {
    it("split A→B, close B → focus A", () => {
      const { result } = renderHook(() => useTabs());
      const paneA = result.current.focusedPaneId!;

      let paneB: string | null = null;
      act(() => {
        paneB = result.current.splitPane(paneA, "horizontal");
      });
      expect(result.current.focusedPaneId).toBe(paneB);

      act(() => {
        result.current.closePane(paneB!);
      });
      expect(result.current.focusedPaneId).toBe(paneA);
    });

    it("split A→B, close A → focus B", () => {
      const { result } = renderHook(() => useTabs());
      const paneA = result.current.focusedPaneId!;

      let paneB: string | null = null;
      act(() => {
        paneB = result.current.splitPane(paneA, "horizontal");
      });

      // Focus A and close it
      act(() => {
        result.current.focusPane(paneA);
      });
      act(() => {
        result.current.closePane(paneA);
      });
      expect(result.current.focusedPaneId).toBe(paneB);
    });
  });

  describe("fullscreen split behavior", () => {
    it("can preserve focus on the original pane during a split", () => {
      const { result } = renderHook(() => useTabs());
      const paneA = result.current.focusedPaneId!;

      let paneB: string | null = null;
      act(() => {
        paneB = result.current.splitPane(paneA, "horizontal", undefined, {
          preserveFocusPaneId: paneA,
        });
      });

      expect(paneB).not.toBeNull();
      expect(result.current.focusedPaneId).toBe(paneA);

      const leaves = getLeafPaneIds(
        result.current.activeTab.panes,
        result.current.activeTab.rootPaneId
      );
      expect(leaves).toEqual([paneA, paneB]);
    });
  });
});
