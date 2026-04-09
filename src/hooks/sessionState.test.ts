import { describe, expect, it } from "vitest";
import {
  clearAllSessionState,
  consumePaneSessionInitOptions,
  getSessionState,
  setPaneSessionInitOptions,
  setSessionState,
  updateSessionState,
} from "./sessionState";
import { createFullscreenSessionState } from "../utils/fullscreenSessionState";

describe("sessionState pane init options", () => {
  it("consumes pane session init options once", () => {
    clearAllSessionState();
    setPaneSessionInitOptions("pane-1", { initialCwd: "/tmp/project" });

    expect(consumePaneSessionInitOptions("pane-1")).toEqual({
      initialCwd: "/tmp/project",
    });
    expect(consumePaneSessionInitOptions("pane-1")).toBeUndefined();
  });

  it("persists interactive command state updates", () => {
    clearAllSessionState();
    setSessionState("session-1", {
      sessionId: "session-1",
      blocks: [],
      isAlternateScreen: false,
      isInteractiveCommandActive: false,
      interactiveSessionKind: null,
      aiAgentKind: null,
      fullscreenOutputStart: 0,
      fullscreenSession: createFullscreenSessionState(),
      rawOutputBaseOffset: 0,
      rawOutput: "",
      currentDirectory: null,
      gitBranch: null,
    });

    updateSessionState("session-1", {
      isInteractiveCommandActive: true,
      interactiveSessionKind: "ai",
      aiAgentKind: "claude",
      fullscreenOutputStart: 42,
      fullscreenSession: {
        ...createFullscreenSessionState(),
        mode: "interactive",
        lifecycle: "active",
        sessionKind: "ai",
        aiAgentKind: "claude",
        startOffset: 42,
      },
    });

    expect(getSessionState("session-1")?.isInteractiveCommandActive).toBe(true);
    expect(getSessionState("session-1")?.interactiveSessionKind).toBe("ai");
    expect(getSessionState("session-1")?.aiAgentKind).toBe("claude");
    expect(getSessionState("session-1")?.fullscreenOutputStart).toBe(42);
    expect(getSessionState("session-1")?.fullscreenSession.mode).toBe("interactive");
  });
});
