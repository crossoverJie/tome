import { useEffect, useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { BlockList } from "./BlockList";
import { InputEditor } from "./InputEditor";
import { RunningCommandBar } from "./RunningCommandBar";
import { FullscreenTerminal } from "./FullscreenTerminal";
import { SearchOverlay } from "./SearchOverlay";
import { AgentLogoBadge } from "./AgentLogoBadge";
import { useTerminalSession } from "../hooks/useTerminalSession";
import { logDiagnostics } from "../utils/diagnostics";
import { getDirectoryLabel } from "../utils/workdir";
import type { AiAgentKind } from "../utils/fullscreenSessionState";

interface PaneViewProps {
  paneId: string;
  sessionId?: string;
  isFocused: boolean;
  onFocus: () => void;
  onWorkingDirectoryChange: (paneId: string, currentDirectory: string | null) => void;
  onAgentStateChange?: (paneId: string, aiAgentKind: AiAgentKind, isActive: boolean) => void;
  onOpenPathInNewTab: (cwd: string) => void;
}

interface ResolvedPathTarget {
  path: string;
  isDirectory: boolean;
  parentDirectory: string;
}

export function PaneView({
  paneId,
  sessionId,
  isFocused,
  onFocus,
  onWorkingDirectoryChange,
  onAgentStateChange,
  onOpenPathInNewTab,
}: PaneViewProps) {
  const {
    sessionId: activeSessionId,
    blocks,
    isInputReady,
    isFullscreenTerminalActive,
    aiAgentKind,
    fullscreenOutputStart,
    rawOutputBaseOffset,
    getRawOutputSnapshot,
    subscribeToRawOutput,
    currentDirectory,
    gitBranch,
    sendInput,
    requestCompletion,
    resizePty,
    notifyFullscreenReady,
    selectedBlockIndex,
    selectBlock,
    toggleBlockCollapse,
    // Search
    searchQuery,
    searchResults,
    currentSearchIndex,
    setSearchQuery,
    nextSearchResult,
    prevSearchResult,
    clearSearch,
    // Running block
    runningBlock,
    // Pane input mode
    paneInputMode,
    sendControlInput,
    // Block navigation
    selectPrevBlock,
    selectNextBlock,
    clearBlocks,
  } = useTerminalSession(paneId, sessionId);

  // Search overlay visibility state (local to each pane)
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const latestPaneSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const fullscreenSessionLabel =
    aiAgentKind === "claude"
      ? "Claude"
      : aiAgentKind === "copilot"
        ? "Copilot"
        : aiAgentKind === "codex"
          ? "Codex"
          : aiAgentKind === "opencode"
            ? "OpenCode"
            : "Interactive";
  const fullscreenPaneTitle = getDirectoryLabel(currentDirectory);
  const createPaneDiagnosticsSnapshot = useCallback(
    (reason: string) => ({
      reason,
      paneId,
      sessionId: activeSessionId,
      isFocused,
      isFullscreenTerminalActive,
      aiAgentKind,
      blockCount: blocks.length,
      selectedBlockIndex,
      rawOutputBaseOffset,
      fullscreenOutputStart,
      currentDirectory,
    }),
    [
      activeSessionId,
      blocks.length,
      currentDirectory,
      fullscreenOutputStart,
      aiAgentKind,
      isFocused,
      isFullscreenTerminalActive,
      paneId,
      rawOutputBaseOffset,
      selectedBlockIndex,
    ]
  );

  useEffect(() => {
    latestPaneSnapshotRef.current = createPaneDiagnosticsSnapshot("latest");
  }, [createPaneDiagnosticsSnapshot]);

  // Resize PTY when pane size changes
  // We use a ResizeObserver in the parent, but here we handle initial size
  useEffect(() => {
    // Default size - actual resize happens via container ref
    resizePty(80, 24);
  }, [resizePty]);

  useEffect(() => {
    onWorkingDirectoryChange(paneId, currentDirectory);
  }, [paneId, currentDirectory, onWorkingDirectoryChange]);

  // Notify parent of agent state changes
  useEffect(() => {
    if (onAgentStateChange) {
      onAgentStateChange(paneId, aiAgentKind, isFullscreenTerminalActive);
    }
  }, [paneId, aiAgentKind, isFullscreenTerminalActive, onAgentStateChange]);

  useEffect(() => {
    logDiagnostics("PaneView", "mount", createPaneDiagnosticsSnapshot("mount"));

    return () => {
      logDiagnostics("PaneView", "unmount", {
        ...(latestPaneSnapshotRef.current ?? {}),
        reason: "unmount",
      });
    };
  }, [paneId]);

  useEffect(() => {
    logDiagnostics("PaneView", "state-change", createPaneDiagnosticsSnapshot("state-change"));
  }, [createPaneDiagnosticsSnapshot]);

  const handleSubmit = useCallback(
    (command: string) => {
      selectBlock(null);
      logDiagnostics("PaneView", "submit", {
        ...createPaneDiagnosticsSnapshot("submit"),
        commandPreview: command.slice(0, 120),
      });
      sendInput(command);
    },
    [createPaneDiagnosticsSnapshot, sendInput, selectBlock]
  );

  // Toggle search overlay
  const toggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => {
      if (prev) {
        clearSearch();
      }
      return !prev;
    });
  }, [clearSearch]);

  // Close search
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    clearSearch();
  }, [clearSearch]);

  // Handle keyboard events for block collapse and search
  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K - clear all blocks
      if (e.metaKey && e.key === "k" && !e.shiftKey) {
        e.preventDefault();
        clearBlocks();
        return;
      }

      // Cmd+↑ - navigate to previous block
      if (e.metaKey && e.key === "ArrowUp") {
        e.preventDefault();
        selectPrevBlock();
        return;
      }

      // Cmd+↓ - navigate to next block
      if (e.metaKey && e.key === "ArrowDown") {
        e.preventDefault();
        selectNextBlock();
        return;
      }

      // Cmd+F - toggle search
      if (e.metaKey && e.key === "f") {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // When search is open
      if (isSearchOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeSearch();
          return;
        }
        // Enter/Shift+Enter handled by SearchOverlay
        return;
      }

      // Enter - toggle collapse of selected block
      if (e.key === "Enter" && selectedBlockIndex !== null && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const block = blocks[selectedBlockIndex];
        if (block) {
          toggleBlockCollapse(block.id);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isFocused,
    isSearchOpen,
    selectedBlockIndex,
    blocks,
    toggleBlockCollapse,
    toggleSearch,
    closeSearch,
    clearBlocks,
    selectPrevBlock,
    selectNextBlock,
  ]);

  // Handle pane focus when clicked
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't focus if clicking on interactive elements
      const target = e.target as HTMLElement;
      if (target.closest(".input-editor-container") || target.closest(".block-output")) {
        onFocus();
        return;
      }
      onFocus();
    },
    [onFocus]
  );

  const handleMouseDownCapture = useCallback(() => {
    onFocus();
  }, [onFocus]);

  const handleOutputLinkActivate = useCallback(
    async (link: { kind: "url" | "path"; target: string; metaKey: boolean }) => {
      try {
        if (link.kind === "url") {
          if (!link.metaKey) {
            return;
          }
          await openUrl(link.target);
          return;
        }

        const resolved = await invoke<ResolvedPathTarget>("resolve_path_target", {
          path: link.target,
          cwd: currentDirectory ?? "/",
        });

        if (link.metaKey) {
          if (resolved.isDirectory) {
            await openPath(resolved.path);
          } else {
            await revealItemInDir(resolved.path);
          }
          return;
        }

        onOpenPathInNewTab(resolved.isDirectory ? resolved.path : resolved.parentDirectory);
      } catch (error) {
        console.error("[tome][output-link] failure", {
          paneId,
          currentDirectory,
          link,
          error,
        });
      }
    },
    [currentDirectory, onOpenPathInNewTab, paneId]
  );

  return (
    <div
      className={`pane-view ${isFocused ? "focused" : ""}`}
      onClick={handleClick}
      onMouseDownCapture={handleMouseDownCapture}
      ref={paneRef}
    >
      <SearchOverlay
        query={searchQuery}
        resultCount={searchResults.length}
        currentIndex={currentSearchIndex}
        isOpen={isSearchOpen}
        onQueryChange={setSearchQuery}
        onNext={nextSearchResult}
        onPrev={prevSearchResult}
        onClose={closeSearch}
      />
      {!isFullscreenTerminalActive && (
        <>
          <BlockList
            blocks={blocks}
            selectedBlockIndex={selectedBlockIndex}
            onSelectBlock={selectBlock}
            onToggleCollapse={toggleBlockCollapse}
            searchResults={searchResults}
            currentSearchIndex={currentSearchIndex}
            runningBlock={runningBlock}
            onOutputLinkActivate={handleOutputLinkActivate}
          />
          {paneInputMode === "editor" && (
            <InputEditor
              onSubmit={handleSubmit}
              onRequestCompletion={requestCompletion}
              onCheckCommandExists={(cmd) =>
                invoke<boolean>("check_command_exists", { command: cmd })
              }
              onCheckPathExists={(path) =>
                invoke<boolean>("check_path_exists", { path, cwd: currentDirectory ?? "/" })
              }
              disabled={!isFocused || isFullscreenTerminalActive || !isInputReady}
              busy={!!runningBlock}
              gitBranch={gitBranch}
              currentDirectory={currentDirectory}
            />
          )}
          {paneInputMode === "running-control" && runningBlock && (
            <RunningCommandBar
              command={blocks.find((b) => b.id === runningBlock.blockId)?.command ?? ""}
              runningBlock={runningBlock}
              onControlInput={sendControlInput}
              onFocus={onFocus}
              isFocused={isFocused}
              gitBranch={gitBranch}
            />
          )}
        </>
      )}
      <div className={`pane-fullscreen-shell ${isFullscreenTerminalActive ? "visible" : "hidden"}`}>
        {isFullscreenTerminalActive && (
          <div className="pane-fullscreen-header" onClick={onFocus}>
            <div className="pane-fullscreen-title-group">
              <span className="pane-fullscreen-badge">{fullscreenSessionLabel}</span>
              <span className="pane-fullscreen-title">{fullscreenPaneTitle}</span>
            </div>
            <span className="pane-fullscreen-focus-hint">
              {isFocused ? "Focused" : "Click to focus"}
            </span>
          </div>
        )}
        <div className="pane-fullscreen-body">
          <FullscreenTerminal
            sessionId={activeSessionId}
            visible={isFullscreenTerminalActive}
            isFocused={isFocused}
            startOffset={fullscreenOutputStart}
            onData={sendInput}
            onResize={resizePty}
            onReady={notifyFullscreenReady}
            getRawOutputSnapshot={getRawOutputSnapshot}
            subscribeToRawOutput={subscribeToRawOutput}
            aiAgentKind={aiAgentKind}
          />
        </div>
      </div>
      <AgentLogoBadge
        aiAgentKind={aiAgentKind}
        isFocused={isFocused}
        isFullscreenTerminalActive={isFullscreenTerminalActive}
      />
    </div>
  );
}
