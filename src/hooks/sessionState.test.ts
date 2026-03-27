import { describe, expect, it } from "vitest";
import {
  clearAllSessionState,
  consumePaneSessionInitOptions,
  setPaneSessionInitOptions,
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
});
