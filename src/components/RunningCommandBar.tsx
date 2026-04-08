import { useEffect, useRef, useCallback } from "react";
import type { RunningBlockState } from "../hooks/useTerminalSession";

interface RunningCommandBarProps {
  command: string;
  runningBlock: RunningBlockState | null;
  onControlInput: (data: string) => void;
  onFocus: () => void;
  isFocused: boolean;
  gitBranch?: string | null;
}

export function RunningCommandBar({
  command,
  runningBlock,
  onControlInput,
  onFocus,
  isFocused,
  gitBranch,
}: RunningCommandBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the container when running mode becomes active and pane is focused
  useEffect(() => {
    if (isFocused && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isFocused]);

  // Handle keyboard events for control keys
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+C - send interrupt signal
      if (e.key === "c" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        onControlInput("\x03");
        return;
      }

      // Ctrl+Z - send suspend signal
      if (e.key === "z" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        onControlInput("\x1a");
        return;
      }

      // Enter - send carriage return
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        onControlInput("\r");
        return;
      }
    },
    [onControlInput]
  );

  // Handle interrupt button click
  const handleInterrupt = useCallback(() => {
    onControlInput("\x03");
  }, [onControlInput]);

  // Get status text based on running block state
  const getStatusText = () => {
    if (!runningBlock) return "";
    switch (runningBlock.status) {
      case "starting":
        return "Starting...";
      case "streaming":
        return "";
      case "quiet":
        return "Idle";
      default:
        return "";
    }
  };

  return (
    <div
      ref={containerRef}
      className={`running-command-bar ${isFocused ? "focused" : ""}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={onFocus}
    >
      <span className="input-prompt">
        ${gitBranch ? <span className="git-branch"> ({gitBranch})</span> : ""}
      </span>
      <div className="running-command-content">
        <div className="running-command-info">
          <span className="running-command-text">{command}</span>
          {getStatusText() && <span className="running-command-status">{getStatusText()}</span>}
        </div>
        <div className="running-command-controls">
          <span className="running-command-shortcuts">Ctrl+C</span>
          <button
            type="button"
            className="running-command-interrupt-button"
            onClick={handleInterrupt}
            title="Send Ctrl+C to interrupt"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
              <path
                d="M5 5L11 11M11 5L5 11"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
