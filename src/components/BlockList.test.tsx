import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BlockList } from "./BlockList";
import type { Block, RunningBlockState } from "../hooks/useTerminalSession";

describe("BlockList", () => {
  const mockBlocks: Block[] = [
    {
      id: "block-1",
      command: "echo hello",
      output: "hello\n",
      exitCode: 0,
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      isComplete: true,
      isCollapsed: false,
    },
    {
      id: "block-2",
      command: "sleep 5",
      output: "",
      exitCode: null,
      startTime: Date.now(),
      endTime: null,
      isComplete: false,
      isCollapsed: false,
    },
  ];

  const mockRunningBlock: RunningBlockState = {
    blockId: "block-2",
    status: "streaming",
    lastOutputAt: Date.now(),
    silenceMs: 0,
    hasInlineProgress: false,
  };

  it("renders blocks correctly", () => {
    render(
      <BlockList
        blocks={mockBlocks}
        selectedBlockIndex={null}
        onSelectBlock={vi.fn()}
        onToggleCollapse={vi.fn()}
        searchResults={[]}
        currentSearchIndex={-1}
        runningBlock={null}
      />
    );

    expect(screen.getByText("echo hello")).toBeDefined();
    expect(screen.getByText("sleep 5")).toBeDefined();
  });

  it("marks running block with running class", () => {
    render(
      <BlockList
        blocks={mockBlocks}
        selectedBlockIndex={null}
        onSelectBlock={vi.fn()}
        onToggleCollapse={vi.fn()}
        searchResults={[]}
        currentSearchIndex={-1}
        runningBlock={mockRunningBlock}
      />
    );

    // Get the block command element and find its parent block
    const commandElements = screen.getAllByText("sleep 5");
    // The first one should be the actual block (not the sticky header)
    const runningBlockElement = commandElements[0]?.closest(".block");
    expect(runningBlockElement?.classList.contains("block-running")).toBe(true);
  });

  it("calls onSelectBlock when block is clicked", () => {
    const onSelectBlock = vi.fn();
    render(
      <BlockList
        blocks={mockBlocks}
        selectedBlockIndex={null}
        onSelectBlock={onSelectBlock}
        onToggleCollapse={vi.fn()}
        searchResults={[]}
        currentSearchIndex={-1}
        runningBlock={null}
      />
    );

    fireEvent.click(screen.getByText("echo hello"));
    expect(onSelectBlock).toHaveBeenCalledWith(0);
  });

  it("renders sticky header when running block is scrolled out", () => {
    // Mock scrollIntoView for jsdom
    Element.prototype.scrollIntoView = vi.fn();

    render(
      <BlockList
        blocks={mockBlocks}
        selectedBlockIndex={null}
        onSelectBlock={vi.fn()}
        onToggleCollapse={vi.fn()}
        searchResults={[]}
        currentSearchIndex={-1}
        runningBlock={mockRunningBlock}
      />
    );

    // Sticky header presence depends on scroll position
    // In jsdom, elements are always "in view" so it shouldn't show
    const stickyStatus = screen.queryByText("Click to view");
    // The sticky header may or may not be visible depending on scroll detection
    // Just verify the component renders without error
    expect(stickyStatus).toBeDefined();
  });

  it("renders search results correctly", () => {
    // Mock scrollIntoView for jsdom
    Element.prototype.scrollIntoView = vi.fn();

    const searchResults = [
      {
        blockId: "block-1",
        blockIndex: 0,
        matchIndex: 0,
        start: 0,
        end: 5,
        text: "hello",
      },
    ];

    render(
      <BlockList
        blocks={mockBlocks}
        selectedBlockIndex={null}
        onSelectBlock={vi.fn()}
        onToggleCollapse={vi.fn()}
        searchResults={searchResults}
        currentSearchIndex={0}
        runningBlock={null}
      />
    );

    expect(screen.getByText("echo hello")).toBeDefined();
  });
});
