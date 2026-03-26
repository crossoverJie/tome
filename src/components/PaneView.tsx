import { useEffect, useCallback, useRef, useState } from "react";
import { BlockList } from "./BlockList";
import { InputEditor } from "./InputEditor";
import { FullscreenTerminal } from "./FullscreenTerminal";
import { SearchOverlay } from "./SearchOverlay";
import { useTerminalSession } from "../hooks/useTerminalSession";

interface PaneViewProps {
  paneId: string;
  sessionId?: string;
  isFocused: boolean;
  onFocus: () => void;
}

export function PaneView({ paneId, sessionId, isFocused, onFocus }: PaneViewProps) {
  const {
    blocks,
    isAlternateScreen,
    rawOutput,
    sendInput,
    resizePty,
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
  } = useTerminalSession(paneId, sessionId);

  // Search overlay visibility state (local to each pane)
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // Resize PTY when pane size changes
  // We use a ResizeObserver in the parent, but here we handle initial size
  useEffect(() => {
    // Default size - actual resize happens via container ref
    resizePty(80, 24);
  }, [resizePty]);

  const handleSubmit = useCallback(
    (command: string) => {
      selectBlock(null);
      sendInput(command);
    },
    [sendInput, selectBlock]
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
  }, [isFocused, isSearchOpen, selectedBlockIndex, blocks, toggleBlockCollapse, toggleSearch, closeSearch]);

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

  return (
    <div className={`pane-view ${isFocused ? "focused" : ""}`} onClick={handleClick} ref={paneRef}>
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
      {!isAlternateScreen && (
        <>
          <BlockList
            blocks={blocks}
            selectedBlockIndex={selectedBlockIndex}
            onSelectBlock={selectBlock}
            onToggleCollapse={toggleBlockCollapse}
            searchResults={searchResults}
            currentSearchIndex={currentSearchIndex}
          />
          <InputEditor onSubmit={handleSubmit} disabled={!isFocused || isAlternateScreen} />
        </>
      )}
      <FullscreenTerminal
        visible={isAlternateScreen}
        onData={sendInput}
        onResize={resizePty}
        rawOutput={rawOutput}
      />
    </div>
  );
}
