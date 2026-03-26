import { useRef, useEffect } from "react";
import { Block as BlockComponent } from "./Block";
import type { Block, SearchResult } from "../hooks/useTerminalSession";

interface BlockListProps {
  blocks: Block[];
  selectedBlockIndex: number | null;
  onSelectBlock: (index: number | null) => void;
  onToggleCollapse: (blockId: string) => void;
  // Search
  searchResults: SearchResult[];
  currentSearchIndex: number;
}

export function BlockList({
  blocks,
  selectedBlockIndex,
  onSelectBlock,
  onToggleCollapse,
  searchResults,
  currentSearchIndex,
}: BlockListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
      {blocks.map((block, index) => (
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
        />
      ))}
    </div>
  );
}
