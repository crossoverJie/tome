import { describe, expect, it } from "vitest";
import { appendTerminalOutputChunk, processTerminalOutput } from "./terminalOutput";

describe("processTerminalOutput", () => {
  it("handles basic carriage return overwrites", () => {
    const input = "Progress: 10%\rProgress: 50%\rProgress: 100%";
    const expected = "Progress: 100%";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles carriage return followed by newline", () => {
    const input = "Progress: 10%\rProgress: 50%\rProgress: 100%\nDone";
    const expected = "Progress: 100%\nDone";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles multiple lines with carriage returns", () => {
    const input = "Line1\rUpdated1\nLine2\rUpdated2\nLine3";
    const expected = "Updated1\nUpdated2\nLine3";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles output without carriage returns", () => {
    const input = "Hello\nWorld\nTest";
    const expected = "Hello\nWorld\nTest";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles single line without newlines", () => {
    const input = "Simple output";
    const expected = "Simple output";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles empty string", () => {
    expect(processTerminalOutput("")).toBe("");
  });

  it("handles carriage return at end without content after", () => {
    const input = "Progress: 50%\r";
    const expected = "";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles multiple carriage returns in sequence", () => {
    const input = "A\rB\rC\rD";
    const expected = "D";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles brew-style progress output", () => {
    // Simulating brew download progress
    const input =
      "Downloading 130.9MB/196.6MB\rDownloading 131.0MB/196.6MB\rDownloading 131.4MB/196.6MB\rDownloading 131.9MB/196.6MB";
    const expected = "Downloading 131.9MB/196.6MB";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles wget-style progress output", () => {
    // Simulating wget progress bar
    const input =
      "10% [====>                                  ]\r50% [=========================>               ]\r100% [=========================================]";
    const expected = "100% [=========================================]";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles mixed \\r\\n and \\n line endings", () => {
    const input = "Line1\r\nLine2\nLine3\r\nLine4";
    const expected = "Line1\nLine2\nLine3\nLine4";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("preserves ANSI escape sequences", () => {
    const input = "\x1b[32mProgress: 10%\x1b[0m\r\x1b[32mProgress: 100%\x1b[0m";
    const expected = "\x1b[32mProgress: 100%\x1b[0m";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles partial line at end (no trailing newline)", () => {
    const input = "Line1\nLine2\rUpdated";
    const expected = "Line1\nUpdated";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles output that ends with newline", () => {
    const input = "Hello\rWorld\n";
    const expected = "World\n";
    expect(processTerminalOutput(input)).toBe(expected);
  });

  it("handles complex multi-line scenario with final progress", () => {
    // Simulating actual brew output pattern
    const input =
      "==> Downloading https://example.com/package.zip\n" +
      "Warning: Your Xcode is outdated\n" +
      "Downloading 10%\rDownloading 50%\rDownloading 100%\n" +
      "==> Installing package";
    const expected =
      "==> Downloading https://example.com/package.zip\n" +
      "Warning: Your Xcode is outdated\n" +
      "Downloading 100%\n" +
      "==> Installing package";
    expect(processTerminalOutput(input)).toBe(expected);
  });
});

describe("appendTerminalOutputChunk", () => {
  it("collapses inline progress updates without losing completed lines", () => {
    let output = "";

    output = appendTerminalOutputChunk(output, "==> Downloading package\n");
    output = appendTerminalOutputChunk(output, "Downloading 10%\r");
    output = appendTerminalOutputChunk(output, "Downloading 50%\r");
    output = appendTerminalOutputChunk(output, "Downloading 100%\n");
    output = appendTerminalOutputChunk(output, "==> Installing package\n");

    expect(output).toBe(
      "==> Downloading package\nDownloading 100%\n==> Installing package\n"
    );
  });
});
