import { describe, expect, it } from "vitest";
import {
  createFullscreenSessionState,
  fullscreenSessionReducer,
  getFullscreenInteractionState,
} from "./fullscreenSessionState";

describe("fullscreenSessionState", () => {
  it("enters interactive activation with a pending launch", () => {
    const initial = createFullscreenSessionState();

    const next = fullscreenSessionReducer(initial, {
      type: "interactive-command-detected",
      commandKind: "claude",
      startOffset: 12,
    });

    expect(next.mode).toBe("interactive");
    expect(next.lifecycle).toBe("activating");
    expect(next.commandKind).toBe("claude");
    expect(next.startOffset).toBe(12);
    expect(next.pendingLaunch).toBe(true);
    expect(getFullscreenInteractionState(next)).toBe("active");
  });

  it("keeps fullscreen active through a pane resize without tearing down", () => {
    const active = fullscreenSessionReducer(createFullscreenSessionState(), {
      type: "interactive-command-started",
      commandKind: "claude",
      startOffset: 18,
    });

    const resized = fullscreenSessionReducer(active, {
      type: "pane-resized",
    });

    expect(active.lifecycle).toBe("active");
    expect(resized.lifecycle).toBe("resizing");
    expect(resized.mode).toBe("interactive");
    expect(resized.pendingLaunch).toBe(false);

    const settled = fullscreenSessionReducer(resized, {
      type: "resize-settled",
    });

    expect(settled.lifecycle).toBe("active");
    expect(settled.mode).toBe("interactive");
    expect(settled.startOffset).toBe(18);
  });

  it("marks a fullscreen split as a local resize instead of tearing the session down", () => {
    const active = fullscreenSessionReducer(createFullscreenSessionState(), {
      type: "interactive-command-started",
      commandKind: "claude",
      startOffset: 24,
    });

    const split = fullscreenSessionReducer(active, {
      type: "pane-split",
    });

    expect(split.lifecycle).toBe("resizing");
    expect(split.mode).toBe("interactive");
    expect(split.startOffset).toBe(24);

    const refocused = fullscreenSessionReducer(split, {
      type: "pane-focused",
    });

    expect(refocused.lifecycle).toBe("active");
    expect(refocused.mode).toBe("interactive");
  });
});
