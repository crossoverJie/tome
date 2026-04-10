/**
 * Process terminal output to handle carriage return (\r) characters.
 *
 * In terminal emulation, \r moves the cursor to the beginning of the line,
 * and subsequent characters overwrite existing content. This is used by
 * progress bars (brew, wget, curl, etc.) to update in place.
 *
 * This function processes the raw terminal output and returns the final
 * rendered text state after applying all \r overwrites.
 *
 * Example:
 *   Input:  "Downloading 10%...\rDownloading 50%...\rDownloading 100%...\n"
 *   Output: "Downloading 100%...\n"
 */
export function processTerminalOutput(output: string): string {
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < output.length; i++) {
    const char = output[i];

    if (char === "\r") {
      // Check if this is \r\n (Windows-style line ending)
      // In that case, treat it as a simple newline
      if (i + 1 < output.length && output[i + 1] === "\n") {
        // \r\n: finalize current line and skip the \n in next iteration
        lines.push(currentLine);
        currentLine = "";
        i++; // Skip the \n
      } else {
        // Carriage return: move to beginning of line (overwrite mode)
        currentLine = "";
      }
    } else if (char === "\n") {
      // Line feed: finalize current line and start new one
      lines.push(currentLine);
      currentLine = "";
    } else {
      // Regular character: append to current line
      currentLine += char;
    }
  }

  // Handle remaining content in currentLine
  // (commands may not end with a newline)
  if (lines.length > 0) {
    return lines.join("\n") + "\n" + currentLine;
  }

  // No newlines: return currentLine as-is (may be empty)
  return currentLine;
}

/**
 * Append a new terminal output chunk onto the current visible block output.
 *
 * Unlike raw output buffers, block output only needs the latest rendered text.
 * Re-processing the combined visible text preserves previous completed lines
 * while collapsing carriage-return progress updates in place.
 */
export function appendTerminalOutputChunk(currentOutput: string, chunk: string): string {
  if (chunk.length === 0) {
    return currentOutput;
  }

  return processTerminalOutput(currentOutput + chunk);
}
