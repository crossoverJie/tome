import { describe, expect, it } from "vitest";
import {
  applyCompletionValue,
  cycleCompletionIndex,
  decideCompletionAction,
} from "./inputCompletion";

describe("applyCompletionValue", () => {
  it("replaces the target range and updates the cursor", () => {
    expect(applyCompletionValue("git sta", 4, 7, "status")).toEqual({
      text: "git status",
      cursor: 10,
    });
  });
});

describe("decideCompletionAction", () => {
  it("returns noop when there are no candidates", () => {
    expect(
      decideCompletionAction(
        {
          replaceFrom: 0,
          replaceTo: 0,
          commonPrefix: null,
          items: [],
        },
        "git st",
        6
      )
    ).toEqual({ kind: "noop" });
  });

  it("applies a single candidate immediately", () => {
    expect(
      decideCompletionAction(
        {
          replaceFrom: 4,
          replaceTo: 6,
          commonPrefix: "status",
          items: [{ value: "status", display: "status", kind: "command" }],
        },
        "git st",
        6
      )
    ).toEqual({
      kind: "apply",
      value: "status",
      replaceFrom: 4,
      replaceTo: 6,
    });
  });

  it("applies the common prefix when it extends the current text", () => {
    expect(
      decideCompletionAction(
        {
          replaceFrom: 4,
          replaceTo: 7,
          commonPrefix: "status",
          items: [
            { value: "status", display: "status", kind: "command" },
            { value: "stash", display: "stash", kind: "command" },
          ],
        },
        "git sta",
        7
      )
    ).toEqual({
      kind: "apply",
      value: "status",
      replaceFrom: 4,
      replaceTo: 7,
    });
  });

  it("opens the menu when multiple distinct candidates remain", () => {
    expect(
      decideCompletionAction(
        {
          replaceFrom: 4,
          replaceTo: 6,
          commonPrefix: "st",
          items: [
            { value: "status", display: "status", kind: "command" },
            { value: "stash", display: "stash", kind: "command" },
          ],
        },
        "git st",
        6
      )
    ).toEqual({
      kind: "open",
      items: [
        { value: "status", display: "status", kind: "command" },
        { value: "stash", display: "stash", kind: "command" },
      ],
      replaceFrom: 4,
      replaceTo: 6,
    });
  });
});

describe("cycleCompletionIndex", () => {
  it("wraps selection in both directions", () => {
    expect(cycleCompletionIndex(0, -1, 3)).toBe(2);
    expect(cycleCompletionIndex(2, 1, 3)).toBe(0);
  });
});
