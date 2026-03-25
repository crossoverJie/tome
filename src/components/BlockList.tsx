import { useRef, useEffect } from "react";
import { Block as BlockComponent } from "./Block";
import type { Block } from "../hooks/useTerminalSession";

interface BlockListProps {
  blocks: Block[];
  selectedBlockIndex: number | null;
  onSelectBlock: (index: number | null) => void;
}

export function BlockList({ blocks, selectedBlockIndex, onSelectBlock }: BlockListProps) {
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
          onClick={() => onSelectBlock(selectedBlockIndex === index ? null : index)}
        />
      ))}
    </div>
  );
}
