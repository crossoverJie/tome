import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaneView } from "./PaneView";
import { createFullscreenSessionState } from "../utils/fullscreenSessionState";

const useTerminalSessionMock = vi.fn();
const invokeMock = vi.fn();
const openUrlMock = vi.fn();
const openPathMock = vi.fn();
const revealItemInDirMock = vi.fn();

vi.mock("../hooks/useTerminalSession", () => ({
  useTerminalSession: (...args: unknown[]) => useTerminalSessionMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
  openPath: (...args: unknown[]) => openPathMock(...args),
  revealItemInDir: (...args: unknown[]) => revealItemInDirMock(...args),
}));

vi.mock("./BlockList", () => ({
  BlockList: (props: {
    onOutputLinkActivate?: (link: {
      kind: string;
      target: string;
      text: string;
      metaKey: boolean;
    }) => void;
  }) => {
    const handleMouseDown = (kind: string, target: string, text: string, metaKey: boolean) => {
      // URL with Cmd key is activated on mouseDown (matching Block.tsx behavior)
      if (kind === "url" && metaKey) {
        props.onOutputLinkActivate?.({ kind, target, text, metaKey });
      }
    };
    const handleClick = (kind: string, target: string, text: string, metaKey: boolean) => {
      props.onOutputLinkActivate?.({ kind, target, text, metaKey });
    };
    return (
      <div className="block-output">
        <span
          data-output-link-kind="url"
          data-output-link-target="https://example.com"
          data-output-link-text="https://example.com"
          onMouseDown={(e) =>
            handleMouseDown("url", "https://example.com", "https://example.com", e.metaKey)
          }
          onClick={(e) =>
            handleClick("url", "https://example.com", "https://example.com", e.metaKey)
          }
        >
          OpenUrl
        </span>
        <span
          data-output-link-kind="path"
          data-output-link-target="src/components/PaneView.tsx"
          data-output-link-text="src/components/PaneView.tsx:10"
          onClick={(e) =>
            handleClick(
              "path",
              "src/components/PaneView.tsx",
              "src/components/PaneView.tsx:10",
              e.metaKey
            )
          }
        >
          OpenPathInTab
        </span>
        <span
          data-output-link-kind="path"
          data-output-link-target="src/components/PaneView.tsx"
          data-output-link-text="src/components/PaneView.tsx:10"
          onClick={(e) =>
            handleClick(
              "path",
              "src/components/PaneView.tsx",
              "src/components/PaneView.tsx:10",
              e.metaKey
            )
          }
        >
          RevealPath
        </span>
      </div>
    );
  },
}));

vi.mock("./InputEditor", () => ({
  InputEditor: () => <div>InputEditor</div>,
}));

vi.mock("./SearchOverlay", () => ({
  SearchOverlay: () => null,
}));

vi.mock("./FullscreenTerminal", () => ({
  FullscreenTerminal: () => <div>Fullscreen hidden</div>,
}));

vi.mock("./RunningCommandBar", () => ({
  RunningCommandBar: () => <div>RunningCommandBar</div>,
}));

function buildHookState() {
  return {
    sessionId: "session-1",
    blocks: [],
    isInputReady: true,
    isAlternateScreen: false,
    isInteractiveCommandActive: false,
    aiAgentKind: null,
    isFullscreenTerminalActive: false,
    fullscreenOutputStart: 0,
    fullscreenSession: createFullscreenSessionState(),
    rawOutputBaseOffset: 0,
    rawOutput: "",
    getRawOutputSnapshot: vi.fn(() => ({ rawOutput: "", rawOutputBaseOffset: 0 })),
    subscribeToRawOutput: vi.fn(() => vi.fn()),
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
    runningBlock: null,
    paneInputMode: "editor",
    sendControlInput: vi.fn(),
  };
}

describe("PaneView output links", () => {
  beforeEach(() => {
    useTerminalSessionMock.mockReset();
    invokeMock.mockReset();
    openUrlMock.mockReset();
    openPathMock.mockReset();
    revealItemInDirMock.mockReset();
    useTerminalSessionMock.mockReturnValue(buildHookState());
  });

  it("opens cmd-clicked URLs in the browser", async () => {
    render(
      <PaneView
        paneId="pane-1"
        isFocused={true}
        onFocus={() => {}}
        onWorkingDirectoryChange={() => {}}
        onOpenPathInNewTab={() => {}}
      />
    );

    fireEvent.mouseDown(screen.getByText("OpenUrl"), { metaKey: true });

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith("https://example.com");
    });
  });

  it("opens clicked file paths in a new Tome tab using the parent directory", async () => {
    const onOpenPathInNewTab = vi.fn();
    invokeMock.mockResolvedValue({
      path: "/tmp/project/src/components/PaneView.tsx",
      isDirectory: false,
      parentDirectory: "/tmp/project/src/components",
    });

    render(
      <PaneView
        paneId="pane-1"
        isFocused={true}
        onFocus={() => {}}
        onWorkingDirectoryChange={() => {}}
        onOpenPathInNewTab={onOpenPathInNewTab}
      />
    );

    fireEvent.click(screen.getByText("OpenPathInTab"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resolve_path_target", {
        path: "src/components/PaneView.tsx",
        cwd: "/tmp/project",
      });
      expect(onOpenPathInNewTab).toHaveBeenCalledWith("/tmp/project/src/components");
    });
  });

  it("reveals cmd-clicked file paths in Finder", async () => {
    invokeMock.mockResolvedValue({
      path: "/tmp/project/src/components/PaneView.tsx",
      isDirectory: false,
      parentDirectory: "/tmp/project/src/components",
    });

    render(
      <PaneView
        paneId="pane-1"
        isFocused={true}
        onFocus={() => {}}
        onWorkingDirectoryChange={() => {}}
        onOpenPathInNewTab={() => {}}
      />
    );

    fireEvent.click(screen.getByText("RevealPath"), { metaKey: true });

    await waitFor(() => {
      expect(revealItemInDirMock).toHaveBeenCalledWith("/tmp/project/src/components/PaneView.tsx");
    });
  });
});
