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
      sessionKind: "ai",
      aiAgentKind: "claude",
      startOffset: 12,
    });

    expect(next.mode).toBe("interactive");
    expect(next.lifecycle).toBe("activating");
    expect(next.sessionKind).toBe("ai");
    expect(next.aiAgentKind).toBe("claude");
    expect(next.startOffset).toBe(12);
    expect(next.pendingLaunch).toBe(true);
    expect(getFullscreenInteractionState(next)).toBe("active");
  });

  it("keeps fullscreen active through a pane resize without tearing down", () => {
    const active = fullscreenSessionReducer(createFullscreenSessionState(), {
      type: "interactive-command-started",
      sessionKind: "ai",
      aiAgentKind: "claude",
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
      sessionKind: "ai",
      aiAgentKind: "claude",
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

  it("preserves the interactive command kind when an AI session enters alternate screen", () => {
    const interactive = fullscreenSessionReducer(createFullscreenSessionState(), {
      type: "interactive-command-started",
      sessionKind: "ai",
      aiAgentKind: "copilot",
      startOffset: 32,
    });

    const alternate = fullscreenSessionReducer(interactive, {
      type: "alternate-screen-entered",
      startOffset: 48,
    });

    expect(alternate.mode).toBe("alternate");
    expect(alternate.lifecycle).toBe("active");
    expect(alternate.sessionKind).toBe("ai");
    expect(alternate.aiAgentKind).toBe("copilot");
    expect(alternate.startOffset).toBe(48);
  });

  it("enters interactive mode for REPL commands like python3", () => {
    const initial = createFullscreenSessionState();

    const next = fullscreenSessionReducer(initial, {
      type: "interactive-command-detected",
      sessionKind: "repl",
      aiAgentKind: null,
      startOffset: 10,
    });

    expect(next.mode).toBe("interactive");
    expect(next.lifecycle).toBe("activating");
    expect(next.sessionKind).toBe("repl");
    expect(next.aiAgentKind).toBeNull();
    expect(next.startOffset).toBe(10);
    expect(next.pendingLaunch).toBe(true);
  });

  it("enters interactive mode for generic TTY commands like psql", () => {
    const initial = createFullscreenSessionState();

    const next = fullscreenSessionReducer(initial, {
      type: "interactive-command-started",
      sessionKind: "generic",
      aiAgentKind: null,
      startOffset: 5,
    });

    expect(next.mode).toBe("interactive");
    expect(next.lifecycle).toBe("active");
    expect(next.sessionKind).toBe("generic");
    expect(next.aiAgentKind).toBeNull();
    expect(next.startOffset).toBe(5);
    expect(next.pendingLaunch).toBe(false);
  });
});
