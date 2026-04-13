import { describe, expect, it } from "vitest";
import {
  applyCompletionValue,
  cycleCompletionIndex,
  decideCompletionAction,
} from "./inputCompletion";
import {
  getHistoryMatches,
  getInlineHistorySuggestion,
  navigateHistoryMatches,
} from "./inputHistory";

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

describe("getHistoryMatches", () => {
  const history = ["git status --short", "ls -la", "git stash", "git status", "pwd", "git status"];

  it("returns recent prefix matches without duplicates", () => {
    expect(getHistoryMatches(history, "git st")).toEqual([
      "git status",
      "git stash",
      "git status --short",
    ]);
  });

  it("returns an empty list for empty prefixes", () => {
    expect(getHistoryMatches(history, "")).toEqual([]);
  });
});

describe("getInlineHistorySuggestion", () => {
  const history = ["claude", "claude --resume", "claude --version"];

  it("returns the most recent strict-prefix match", () => {
    expect(getInlineHistorySuggestion(history, "claude --r", 10)).toEqual({
      fullCommand: "claude --resume",
      suffix: "esume",
    });
  });

  it("does not suggest when the cursor is not at the end", () => {
    expect(getInlineHistorySuggestion(history, "claude --r", 5)).toBeNull();
  });

  it("does not suggest when the input already equals a history item", () => {
    expect(getInlineHistorySuggestion(history, "claude --resume", 16)).toBeNull();
  });
});

describe("navigateHistoryMatches", () => {
  const matches = ["ls -lah", "ls -la", "ls"];

  it("starts from the most recent match on ArrowUp", () => {
    expect(navigateHistoryMatches(matches, -1, -1)).toEqual({
      index: 0,
      value: "ls -lah",
    });
  });

  it("moves forward through older matches on ArrowUp", () => {
    expect(navigateHistoryMatches(matches, 0, -1)).toEqual({
      index: 1,
      value: "ls -la",
    });
  });

  it("returns to the original input after the newest match on ArrowDown", () => {
    expect(navigateHistoryMatches(matches, 0, 1)).toEqual({
      index: -1,
      value: null,
    });
  });
});
