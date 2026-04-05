import { describe, expect, it } from "vitest";
import {
  appendRawOutputChunk,
  FULLSCREEN_REPLAY_BUFFER_LIMIT,
  FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
  getRawOutputAbsoluteEnd,
  RAW_OUTPUT_BUFFER_LIMIT,
  RAW_OUTPUT_BUFFER_TRIM_TARGET,
} from "./rawOutputBuffer";

describe("rawOutputBuffer", () => {
  it("keeps appending output until the buffer limit is reached", () => {
    const result = appendRawOutputChunk(
      {
        rawOutput: "prompt\n",
        rawOutputBaseOffset: 0,
      },
      "claude"
    );

    expect(result.rawOutput).toBe("prompt\nclaude");
    expect(result.rawOutputBaseOffset).toBe(0);
    expect(result.didTrim).toBe(false);
    expect(getRawOutputAbsoluteEnd(result)).toBe("prompt\nclaude".length);
  });

  it("trims the oldest output once the buffer exceeds the cap", () => {
    const initialOutput = "a".repeat(RAW_OUTPUT_BUFFER_LIMIT - 4);
    const result = appendRawOutputChunk(
      {
        rawOutput: initialOutput,
        rawOutputBaseOffset: 12,
      },
      "bcdefghi"
    );

    expect(result.didTrim).toBe(true);
    expect(result.rawOutput.length).toBe(RAW_OUTPUT_BUFFER_TRIM_TARGET);
    expect(result.trimmedCharCount).toBe(initialOutput.length + 8 - RAW_OUTPUT_BUFFER_TRIM_TARGET);
    expect(result.rawOutputBaseOffset).toBe(12 + result.trimmedCharCount);
    expect(result.rawOutput.endsWith("bcdefghi")).toBe(true);
  });

  it("supports a stricter fullscreen replay budget", () => {
    const result = appendRawOutputChunk(
      {
        rawOutput: "a".repeat(FULLSCREEN_REPLAY_BUFFER_LIMIT - 2),
        rawOutputBaseOffset: 40,
      },
      "bcdef",
      {
        limit: FULLSCREEN_REPLAY_BUFFER_LIMIT,
        trimTarget: FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
      }
    );

    expect(result.didTrim).toBe(true);
    expect(result.rawOutput.length).toBe(FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET);
    expect(result.rawOutputBaseOffset).toBe(
      40 + (FULLSCREEN_REPLAY_BUFFER_LIMIT - 2 + 5 - FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET)
    );
  });
});
