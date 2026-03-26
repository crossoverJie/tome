import { useRef, useEffect, memo } from "react";
import AnsiToHtml from "ansi-to-html";

const ansiConverter = new AnsiToHtml({
  fg: "#d4d4d4",
  bg: "transparent",
  newline: true,
  escapeXML: true,
});

interface BlockProps {
  command: string;
  output: string;
  exitCode: number | null;
  startTime: number;
  endTime: number | null;
  isComplete: boolean;
  isSelected: boolean;
  isCollapsed: boolean;
  onClick: () => void;
  onToggleCollapse: () => void;
  // Search
  searchRanges?: Array<{ start: number; end: number }>;
  activeSearchRange?: { start: number; end: number } | null;
}

export function formatDuration(start: number, end: number | null): string {
  if (!end) return "...";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Helper function to highlight search results in ANSI text
// The search ranges are based on PLAIN TEXT (without ANSI sequences)
function highlightSearchResults(
  ansiText: string,
  ranges: Array<{ start: number; end: number }>,
  activeRange: { start: number; end: number } | null | undefined,
  converter: AnsiToHtml
): string {
  if (!ranges.length) return converter.toHtml(ansiText);

  // Step 1: Build position mapping from plain text index to ANSI text index
  const plainToAnsiMap: number[] = [];
  let i = 0;

  while (i < ansiText.length) {
    if (ansiText[i] === "\x1b" && i + 1 < ansiText.length && ansiText[i + 1] === "[") {
      // ANSI sequence start - skip it
      i += 2; // Skip \x1b[
      while (i < ansiText.length && !ansiText[i].match(/[mGK]/)) {
        i++;
      }
      if (i < ansiText.length) {
        i++; // Skip the terminating character
      }
    } else {
      // Regular character
      plainToAnsiMap.push(i);
      i++;
    }
  }

  const totalPlainLength = plainToAnsiMap.length;

  // Step 2: Sort and validate ranges
  const sortedRanges = [...ranges]
    .filter((r) => r.start >= 0 && r.start < totalPlainLength)
    .map((r) => ({ start: r.start, end: Math.min(r.end, totalPlainLength) }))
    .sort((a, b) => a.start - b.start);

  if (sortedRanges.length === 0) return converter.toHtml(ansiText);

  // Step 3: Merge overlapping ranges
  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of sortedRanges) {
    if (mergedRanges.length === 0) {
      mergedRanges.push(range);
    } else {
      const last = mergedRanges[mergedRanges.length - 1];
      if (range.start <= last.end) {
        // Overlapping - extend
        last.end = Math.max(last.end, range.end);
      } else {
        mergedRanges.push(range);
      }
    }
  }

  // Step 4: Build result
  let result = "";
  let lastPlainEnd = 0;

  for (const range of mergedRanges) {
    // Add text before this match
    if (range.start > lastPlainEnd) {
      const ansiStart = plainToAnsiMap[lastPlainEnd];
      const ansiEnd = plainToAnsiMap[range.start];
      result += converter.toHtml(ansiText.slice(ansiStart, ansiEnd));
    }

    // Add highlighted match
    const isActive =
      activeRange && range.start === activeRange.start && range.end === activeRange.end;
    const className = isActive ? "search-highlight-active" : "search-highlight";
    const matchAnsiStart = plainToAnsiMap[range.start];
    const matchAnsiEnd =
      range.end < totalPlainLength ? plainToAnsiMap[range.end] : ansiText.length;
    const matchText = ansiText.slice(matchAnsiStart, matchAnsiEnd);
    result += `<span class="${className}">${converter.toHtml(matchText)}</span>`;

    lastPlainEnd = range.end;
  }

  // Add remaining text after last match
  if (lastPlainEnd < totalPlainLength) {
    const ansiLastEnd = plainToAnsiMap[lastPlainEnd];
    result += converter.toHtml(ansiText.slice(ansiLastEnd));
  }

  return result;
}

export const Block = memo(function Block({
  command,
  output,
  exitCode,
  startTime,
  endTime,
  isComplete,
  isSelected,
  isCollapsed,
  onClick,
  onToggleCollapse,
  searchRanges,
  activeSearchRange,
}: BlockProps) {
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      // Apply search highlighting on original text before HTML conversion
      if (searchRanges && searchRanges.length > 0) {
        outputRef.current.innerHTML = highlightSearchResults(
          output,
          searchRanges,
          activeSearchRange,
          ansiConverter
        );
      } else {
        outputRef.current.innerHTML = ansiConverter.toHtml(output);
      }
    }
  }, [output, searchRanges, activeSearchRange]);

  const exitCodeClass = exitCode === null ? "" : exitCode === 0 ? "exit-success" : "exit-error";

  return (
    <div
      className={`block ${isSelected ? "block-selected" : ""} ${exitCodeClass}`}
      onClick={onClick}
    >
      <div className="block-header">
        <button
          className="block-collapse-btn"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
        <span className="block-prompt">$</span>
        <span className="block-command">{command || "(empty)"}</span>
        <span className="block-meta">
          {isComplete && exitCode !== null && (
            <span className={`block-exit-code ${exitCode === 0 ? "success" : "error"}`}>
              {exitCode === 0 ? "✓" : `✗ ${exitCode}`}
            </span>
          )}
          <span className="block-duration">{formatDuration(startTime, endTime)}</span>
        </span>
      </div>
      {!isCollapsed && output && (
        <div className="block-output">
          <pre ref={outputRef} />
        </div>
      )}
      {isCollapsed && output && (
        <div className="block-output-collapsed">{isCollapsed ? "..." : ""}</div>
      )}
    </div>
  );
});
