import { useRef, useEffect, useState, memo } from "react";
import AnsiToHtml from "ansi-to-html";
import { processTerminalOutput } from "../utils/terminalOutput";
import { linkifyOutputElement, type OutputLinkKind } from "../utils/outputLinks";
import type { RunningBlockStatus } from "../hooks/useTerminalSession";

const ansiConverter = new AnsiToHtml({
  fg: "#d4d4d4",
  bg: "transparent",
  newline: true,
  escapeXML: true,
});

// Filter out non-SGR CSI sequences that shouldn't be displayed
// Matches sequences like: ?25h (show cursor), >4;m (mouse mode), etc.
// Keeps SGR sequences: \x1b[...m (colors/styles)
function filterControlSequences(text: string): string {
  // CSI sequences pattern: \x1b\[ followed by parameters and a final byte
  // We want to keep SGR sequences (ending in 'm')
  // Remove other CSI sequences like ?25h, >4;m, etc.
  return text.replace(/\x1b\[[^m]*[A-Za-z]/g, (match) => {
    // Keep SGR sequences (ending with 'm')
    if (match.endsWith("m") && !match.includes("?") && !match.includes(">")) {
      return match;
    }
    // Remove other control sequences
    return "";
  });
}

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
  // Running block
  isRunning?: boolean;
  runningStatus?: RunningBlockStatus;
  silenceMs?: number;
  hasInlineProgress?: boolean;
  onOutputLinkActivate?: (link: {
    kind: OutputLinkKind;
    target: string;
    text: string;
    metaKey: boolean;
  }) => void;
}

export function formatDuration(start: number, end: number | null): string {
  if (!end) return "...";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Format running duration for display
function formatRunningDuration(startTime: number): string {
  const ms = Date.now() - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Format silence duration for display
function formatSilence(ms: number): string {
  if (ms < 1000) return `${Math.floor(ms / 100) * 100}ms`;
  return `${Math.floor(ms / 1000)}s`;
}

// Get status text based on running status
function getStatusText(
  status: RunningBlockStatus,
  silenceMs: number,
  hasInlineProgress: boolean
): string {
  switch (status) {
    case "starting":
      return "Running";
    case "streaming":
      return hasInlineProgress ? "Streaming output · Updating in place" : "Streaming output";
    case "quiet":
      return `No new output for ${formatSilence(silenceMs)}`;
    default:
      return "Running";
  }
}

// Hook to update running duration every 100ms
function useRunningDuration(startTime: number, isRunning: boolean): string {
  const [duration, setDuration] = useState(() =>
    isRunning ? formatRunningDuration(startTime) : ""
  );

  useEffect(() => {
    if (!isRunning) {
      setDuration("");
      return;
    }

    setDuration(formatRunningDuration(startTime));
    const interval = setInterval(() => {
      setDuration(formatRunningDuration(startTime));
    }, 100);

    return () => clearInterval(interval);
  }, [startTime, isRunning]);

  return duration;
}

// Helper function to highlight search results in ANSI text
// The search ranges are based on PLAIN TEXT (without ANSI sequences)
// Note: ansiText should already be processed (filtered and \r handled) before calling this function
function highlightSearchResults(
  ansiText: string,
  ranges: Array<{ start: number; end: number }>,
  activeRange: { start: number; end: number } | null | undefined,
  converter: AnsiToHtml
): string {
  // ansiText is already filtered and processed by the caller
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
    const matchAnsiEnd = range.end < totalPlainLength ? plainToAnsiMap[range.end] : ansiText.length;
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
  // Running block props
  isRunning = false,
  runningStatus = "starting",
  silenceMs = 0,
  hasInlineProgress = false,
  onOutputLinkActivate,
}: BlockProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  const lastMouseDownActivationRef = useRef<string | null>(null);
  const runningDuration = useRunningDuration(startTime, isRunning);

  useEffect(() => {
    if (outputRef.current) {
      // Filter out non-SGR control sequences before converting to HTML
      const filteredOutput = filterControlSequences(output);
      // Process carriage returns to handle progress bar overwrites
      const processedOutput = processTerminalOutput(filteredOutput);
      // Apply search highlighting on processed text before HTML conversion
      if (searchRanges && searchRanges.length > 0) {
        outputRef.current.innerHTML = highlightSearchResults(
          processedOutput,
          searchRanges,
          activeSearchRange,
          ansiConverter
        );
      } else {
        outputRef.current.innerHTML = ansiConverter.toHtml(processedOutput);
      }
      linkifyOutputElement(outputRef.current);
    }
  }, [output, searchRanges, activeSearchRange]);

  const handleOutputLinkEvent = (
    target: EventTarget | null,
    metaKey: boolean
  ): {
    kind: OutputLinkKind;
    target: string;
    text: string;
    metaKey: boolean;
  } | null => {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const outputLink = target.closest<HTMLElement>("[data-output-link-kind]");
    if (!outputLink) {
      return null;
    }

    const kind = outputLink.dataset.outputLinkKind as OutputLinkKind | undefined;
    const targetValue = outputLink.dataset.outputLinkTarget;
    const text = outputLink.dataset.outputLinkText;
    if (!kind || !targetValue || !text) {
      return null;
    }

    return {
      kind,
      target: targetValue,
      text,
      metaKey,
    };
  };

  useEffect(() => {
    const outputElement = outputRef.current;
    if (!outputElement) {
      return;
    }

    const handleNativeMouseDown = (event: MouseEvent) => {
      const link = handleOutputLinkEvent(event.target, event.metaKey);
      if (!link) {
        return;
      }

      if (link.kind === "url" && link.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        lastMouseDownActivationRef.current = `${link.kind}:${link.target}`;
        onOutputLinkActivate?.(link);
      }
    };

    const handleNativeClick = (event: MouseEvent) => {
      const link = handleOutputLinkEvent(event.target, event.metaKey);
      if (!link) {
        return;
      }

      const activationKey = `${link.kind}:${link.target}`;
      if (lastMouseDownActivationRef.current === activationKey) {
        lastMouseDownActivationRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.stopPropagation();
      if (link.kind === "url" && !link.metaKey) {
        return;
      }

      event.preventDefault();
      onOutputLinkActivate?.(link);
    };

    outputElement.addEventListener("mousedown", handleNativeMouseDown, true);
    outputElement.addEventListener("click", handleNativeClick, true);

    return () => {
      outputElement.removeEventListener("mousedown", handleNativeMouseDown, true);
      outputElement.removeEventListener("click", handleNativeClick, true);
    };
  }, [onOutputLinkActivate]);

  // Compute classes and status
  const exitCodeClass = exitCode === null ? "" : exitCode === 0 ? "exit-success" : "exit-error";
  const runningClass = isRunning ? "block-running" : "";
  const statusText = isRunning ? getStatusText(runningStatus, silenceMs, hasInlineProgress) : "";

  return (
    <div
      className={`block ${isSelected ? "block-selected" : ""} ${exitCodeClass} ${runningClass}`}
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
        {isRunning && (
          <span className="block-running-indicator" aria-label="Running">
            <span className="running-dot" />
          </span>
        )}
        <span className="block-meta">
          {isRunning ? (
            <>
              <span className="block-status">{statusText}</span>
              <span className="block-duration running">{runningDuration}</span>
            </>
          ) : (
            <>
              {isComplete && exitCode !== null && (
                <span className={`block-exit-code ${exitCode === 0 ? "success" : "error"}`}>
                  {exitCode === 0 ? "✓" : `✗ ${exitCode}`}
                </span>
              )}
              <span className="block-duration">{formatDuration(startTime, endTime)}</span>
            </>
          )}
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
