import { useRef, useEffect, useState } from "react";
import { Block as BlockComponent } from "./Block";
import type { Block, SearchResult, RunningBlockState } from "../hooks/useTerminalSession";
import type { OutputLinkKind } from "../utils/outputLinks";

interface BlockListProps {
  blocks: Block[];
  selectedBlockIndex: number | null;
  onSelectBlock: (index: number | null) => void;
  onToggleCollapse: (blockId: string) => void;
  // Search
  searchResults: SearchResult[];
  currentSearchIndex: number;
  // Running block
  runningBlock: RunningBlockState | null;
  onOutputLinkActivate?: (link: {
    kind: OutputLinkKind;
    target: string;
    text: string;
    metaKey: boolean;
  }) => void;
}

export function BlockList({
  blocks,
  selectedBlockIndex,
  onSelectBlock,
  onToggleCollapse,
  searchResults,
  currentSearchIndex,
  runningBlock,
  onOutputLinkActivate,
}: BlockListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);

  // Find the running block index
  const runningBlockIndex = runningBlock
    ? blocks.findIndex((b) => b.id === runningBlock.blockId)
    : -1;

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (containerRef.current && selectedBlockIndex === null) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [blocks, selectedBlockIndex]);

  // Scroll selected block into view
  useEffect(() => {
    if (selectedBlockIndex !== null && containerRef.current) {
      const blockEl = containerRef.current.children[selectedBlockIndex];
      if (blockEl) {
        blockEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedBlockIndex]);

  // Scroll to current search result
  useEffect(() => {
    if (currentSearchIndex >= 0 && searchResults.length > 0 && containerRef.current) {
      const currentResult = searchResults[currentSearchIndex];
      if (currentResult) {
        const blockEl = containerRef.current.children[currentResult.blockIndex];
        if (blockEl) {
          blockEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }
  }, [currentSearchIndex, searchResults]);

  // Track if running block is scrolled out of view
  useEffect(() => {
    if (!runningBlock || runningBlockIndex < 0 || !containerRef.current) {
      setShowStickyHeader(false);
      return;
    }

    const container = containerRef.current;
    const handleScroll = () => {
      const runningEl = container.children[runningBlockIndex] as HTMLElement | undefined;
      if (runningEl) {
        const rect = runningEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        // Show sticky if running block is above the visible area
        // (its bottom is above the container's top + some margin)
        const isScrolledOut = rect.bottom < containerRect.top + 100;
        // Or if it's below the visible area
        const isBelowVisible = rect.top > containerRect.bottom - 50;
        setShowStickyHeader(isScrolledOut || isBelowVisible);
      }
    };

    container.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, [runningBlock, runningBlockIndex, blocks.length]);

  // Jump to running block
  const jumpToRunningBlock = () => {
    if (runningBlockIndex >= 0 && containerRef.current) {
      const blockEl = containerRef.current.children[runningBlockIndex];
      if (blockEl) {
        blockEl.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }
  };

  // Helper to get search ranges for a specific block
  const getSearchRangesForBlock = (blockId: string) => {
    return searchResults
      .filter((r) => r.blockId === blockId)
      .map((r) => ({ start: r.start, end: r.end }));
  };

  // Helper to get active search range for a specific block
  const getActiveSearchRangeForBlock = (blockId: string) => {
    if (currentSearchIndex < 0 || !searchResults[currentSearchIndex]) return null;
    const activeResult = searchResults[currentSearchIndex];
    if (activeResult.blockId !== blockId) return null;
    return { start: activeResult.start, end: activeResult.end };
  };

  return (
    <div className="block-list" ref={containerRef}>
      {blocks.map((block, index) => {
        const isRunning = runningBlock?.blockId === block.id && !block.isComplete;
        return (
          <BlockComponent
            key={block.id}
            command={block.command}
            output={block.output}
            exitCode={block.exitCode}
            startTime={block.startTime}
            endTime={block.endTime}
            isComplete={block.isComplete}
            isSelected={selectedBlockIndex === index}
            isCollapsed={block.isCollapsed}
            onClick={() => onSelectBlock(selectedBlockIndex === index ? null : index)}
            onToggleCollapse={() => {
              onSelectBlock(index);
              onToggleCollapse(block.id);
            }}
            searchRanges={getSearchRangesForBlock(block.id)}
            activeSearchRange={getActiveSearchRangeForBlock(block.id)}
            // Running block props
            isRunning={isRunning}
            runningStatus={isRunning ? runningBlock?.status : undefined}
            silenceMs={isRunning ? runningBlock?.silenceMs : undefined}
            hasInlineProgress={isRunning ? runningBlock?.hasInlineProgress : undefined}
            onOutputLinkActivate={onOutputLinkActivate}
          />
        );
      })}
      {/* Sticky running block summary */}
      {showStickyHeader && runningBlock && runningBlockIndex >= 0 && (
        <div className="block-list-sticky-header" onClick={jumpToRunningBlock}>
          <span className="sticky-indicator">●</span>
          <span className="sticky-command">
            {blocks[runningBlockIndex]?.command || "Running command"}
          </span>
          <span className="sticky-status">Click to view</span>
        </div>
      )}
    </div>
  );
}
