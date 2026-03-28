import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaneView } from "./PaneView";

const useTerminalSessionMock = vi.fn();

vi.mock("../hooks/useTerminalSession", () => ({
  useTerminalSession: (...args: unknown[]) => useTerminalSessionMock(...args),
}));

vi.mock("./BlockList", () => ({
  BlockList: () => <div>BlockList</div>,
}));

vi.mock("./InputEditor", () => ({
  InputEditor: () => <div>InputEditor</div>,
}));

vi.mock("./SearchOverlay", () => ({
  SearchOverlay: () => null,
}));

vi.mock("./FullscreenTerminal", () => ({
  FullscreenTerminal: ({ visible, startOffset }: { visible: boolean; startOffset: number }) => (
    <div>{visible ? `Fullscreen visible ${startOffset}` : "Fullscreen hidden"}</div>
  ),
}));

function buildHookState() {
  return {
    sessionId: "session-1",
    blocks: [],
    isInputReady: true,
    isAlternateScreen: false,
    isInteractiveCommandActive: false,
    isFullscreenTerminalActive: false,
    fullscreenOutputStart: 0,
    rawOutput: "",
    currentDirectory: "/tmp/project",
    gitBranch: "main",
    sendInput: vi.fn(),
    requestCompletion: vi.fn(),
    resizePty: vi.fn(),
    notifyFullscreenReady: vi.fn(),
    clearBlocks: vi.fn(),
    selectedBlockIndex: null,
    selectBlock: vi.fn(),
    selectPrevBlock: vi.fn(),
    selectNextBlock: vi.fn(),
    toggleBlockCollapse: vi.fn(),
    searchQuery: "",
    searchResults: [],
    currentSearchIndex: -1,
    setSearchQuery: vi.fn(),
    nextSearchResult: vi.fn(),
    prevSearchResult: vi.fn(),
    clearSearch: vi.fn(),
  };
}

describe("PaneView", () => {
  beforeEach(() => {
    useTerminalSessionMock.mockReset();
  });

  it("renders block mode UI when no fullscreen terminal is active", () => {
    useTerminalSessionMock.mockReturnValue(buildHookState());

    render(
      <PaneView
        paneId="pane-1"
        isFocused={true}
        onFocus={() => {}}
        onWorkingDirectoryChange={() => {}}
      />
    );

    expect(screen.getByText("BlockList")).toBeTruthy();
    expect(screen.getByText("InputEditor")).toBeTruthy();
    expect(screen.getByText("Fullscreen hidden")).toBeTruthy();
  });

  it("hides block mode UI when claude fullscreen mode is active", () => {
    useTerminalSessionMock.mockReturnValue({
      ...buildHookState(),
      isInteractiveCommandActive: true,
      isFullscreenTerminalActive: true,
      fullscreenOutputStart: 12,
    });

    render(
      <PaneView
        paneId="pane-1"
        isFocused={true}
        onFocus={() => {}}
        onWorkingDirectoryChange={() => {}}
      />
    );

    expect(screen.queryByText("BlockList")).toBeNull();
    expect(screen.queryByText("InputEditor")).toBeNull();
    expect(screen.getByText("Fullscreen visible 12")).toBeTruthy();
  });
});
