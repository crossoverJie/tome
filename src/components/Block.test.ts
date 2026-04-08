import { describe, it, expect } from "vitest";
import { formatDuration } from "./Block";

describe("formatDuration", () => {
  it('returns "..." when end is null', () => {
    expect(formatDuration(1000, null)).toBe("...");
  });

  it("returns milliseconds for durations under 1 second", () => {
    expect(formatDuration(1000, 1050)).toBe("50ms");
    expect(formatDuration(1000, 1999)).toBe("999ms");
    expect(formatDuration(1000, 1000)).toBe("0ms");
  });

  it("returns seconds with one decimal for durations >= 1 second", () => {
    expect(formatDuration(1000, 2000)).toBe("1.0s");
    expect(formatDuration(1000, 2500)).toBe("1.5s");
    expect(formatDuration(1000, 11000)).toBe("10.0s");
  });

  it('returns "..." when end is 0 (falsy)', () => {
    expect(formatDuration(1000, 0)).toBe("...");
  });
});

describe("Block running state helpers", () => {
  // Helper functions are tested indirectly through component integration
  // but we can verify the logic exists by checking the module exports
  it("module exports formatDuration for running block duration display", () => {
    expect(typeof formatDuration).toBe("function");
  });
});
