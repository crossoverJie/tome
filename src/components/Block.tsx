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
  onClick: () => void;
}

export function formatDuration(start: number, end: number | null): string {
  if (!end) return "...";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const Block = memo(function Block({
  command,
  output,
  exitCode,
  startTime,
  endTime,
  isComplete,
  isSelected,
  onClick,
}: BlockProps) {
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.innerHTML = ansiConverter.toHtml(output);
    }
  }, [output]);

  const exitCodeClass = exitCode === null ? "" : exitCode === 0 ? "exit-success" : "exit-error";

  return (
    <div
      className={`block ${isSelected ? "block-selected" : ""} ${exitCodeClass}`}
      onClick={onClick}
    >
      <div className="block-header">
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
      {output && (
        <div className="block-output">
          <pre ref={outputRef} />
        </div>
      )}
    </div>
  );
});
