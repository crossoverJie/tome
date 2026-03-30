import { describe, expect, it } from "vitest";
import {
  clearAllSessionState,
  consumePaneSessionInitOptions,
  getSessionState,
  setPaneSessionInitOptions,
  setSessionState,
  updateSessionState,
} from "./sessionState";

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
      interactiveCommandKind: null,
      fullscreenOutputStart: 0,
      rawOutput: "",
      currentDirectory: null,
      gitBranch: null,
    });

    updateSessionState("session-1", {
      isInteractiveCommandActive: true,
      interactiveCommandKind: "claude",
      fullscreenOutputStart: 42,
    });

    expect(getSessionState("session-1")?.isInteractiveCommandActive).toBe(true);
    expect(getSessionState("session-1")?.interactiveCommandKind).toBe("claude");
    expect(getSessionState("session-1")?.fullscreenOutputStart).toBe(42);
  });
});
