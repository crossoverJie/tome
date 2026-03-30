import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllSessionState, setPaneSessionInitOptions } from "./sessionState";
import { useTerminalSession } from "./useTerminalSession";

type TerminalEventPayload =
  | { kind: "current_directory"; session_id: string; path: string }
  | { kind: "raw_output"; session_id: string; data: string }
  | { kind: "output"; session_id: string; data: string }
  | { kind: "block"; session_id: string; event_type: string; exit_code: number | null }
  | { kind: "alternate_screen"; session_id: string; active: boolean }
  | { kind: "git_branch"; session_id: string; branch: string | null };

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(
    async (command) => {
      switch (command) {
        case "create_session":
          return "session-1";
        case "get_current_directory":
          return "/Users/chenjie/Documents/dev/github/tome";
        case "write_input":
        case "resize_pty":
          return undefined;
        case "request_completion":
          return {
            replaceFrom: 0,
            replaceTo: 0,
            commonPrefix: null,
            items: [],
          };
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
      }
    }
  ),
  listenMock: vi.fn(),
}));

let terminalEventListener: ((event: { payload: TerminalEventPayload }) => void) | undefined;
listenMock.mockImplementation(
  async (_event: string, handler: (event: { payload: TerminalEventPayload }) => void) => {
    terminalEventListener = handler;
    return () => {};
  }
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

describe("useTerminalSession", () => {
  async function flushAsyncWork() {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
    });
  }

  beforeEach(() => {
    clearAllSessionState();
    terminalEventListener = undefined;
    vi.useRealTimers();
    invokeMock.mockClear();
    listenMock.mockClear();
  });

  it("loads the initial cwd and reacts to cwd updates", async () => {
    const { result } = renderHook(() => useTerminalSession("pane-1"));

    await waitFor(() => {
      expect(result.current.sessionId).toBe("session-1");
      expect(result.current.currentDirectory).toBe("/Users/chenjie/Documents/dev/github/tome");
    });

    expect(invokeMock).toHaveBeenCalledWith("get_current_directory", { sessionId: "session-1" });
    expect(listenMock).toHaveBeenCalledWith("terminal-event", expect.any(Function));
    const getCwdCallIndex = invokeMock.mock.calls.findIndex(
      ([command]) => command === "get_current_directory"
    );
    expect(getCwdCallIndex).toBeGreaterThan(-1);
    expect(listenMock.mock.invocationCallOrder[0]).toBeLessThan(
      invokeMock.mock.invocationCallOrder[getCwdCallIndex]
    );

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "current_directory",
          session_id: "session-1",
          path: "/tmp/next-project",
        },
      });
    });

    await waitFor(() => {
      expect(result.current.currentDirectory).toBe("/tmp/next-project");
    });
  });

  it("passes a pending initial cwd when creating a split session", async () => {
    setPaneSessionInitOptions("pane-split", { initialCwd: "/tmp/source-pane" });

    const { result } = renderHook(() => useTerminalSession("pane-split"), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("session-1");
    });

    const createSessionCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "create_session"
    );
    expect(createSessionCalls).toEqual([["create_session", { initialCwd: "/tmp/source-pane" }]]);
  });

  it("consumes pending initial cwd only once per pane", async () => {
    setPaneSessionInitOptions("pane-once", { initialCwd: "/tmp/source-pane" });

    const firstRender = renderHook(() => useTerminalSession("pane-once"));
    await waitFor(() => {
      expect(firstRender.result.current.sessionId).toBe("session-1");
    });
    firstRender.unmount();

    clearAllSessionState();
    terminalEventListener = undefined;
    invokeMock.mockClear();
    listenMock.mockClear();

    const secondRender = renderHook(() => useTerminalSession("pane-once"));
    await waitFor(() => {
      expect(secondRender.result.current.sessionId).toBe("session-1");
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "create_session");
  });

  it("keeps input guarded until startup settles, then unlocks via fallback", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTerminalSession("pane-1"));

    await flushAsyncWork();

    expect(result.current.sessionId).toBe("session-1");
    expect(result.current.isInputReady).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(result.current.isInputReady).toBe(true);
  });

  it("marks input ready immediately when the shell emits input_start", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTerminalSession("pane-1"));

    await flushAsyncWork();

    expect(result.current.sessionId).toBe("session-1");
    expect(result.current.isInputReady).toBe(false);

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "input_start",
          exit_code: null,
        },
      });
    });

    expect(result.current.isInputReady).toBe(true);
  });

  it("switches claude commands into terminal-controlled fullscreen mode", async () => {
    const { result } = renderHook(() => useTerminalSession("pane-1"));

    await waitFor(() => {
      expect(result.current.sessionId).toBe("session-1");
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "input_start",
          exit_code: null,
        },
      });
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "raw_output",
          session_id: "session-1",
          data: "shell prompt\n",
        },
      });
    });

    const preClaudeOutputLength = result.current.rawOutput.length;

    act(() => {
      result.current.sendInput("claude --continue\n");
    });

    expect(result.current.isInteractiveCommandActive).toBe(true);
    expect(result.current.interactiveCommandKind).toBe("claude");
    expect(result.current.isFullscreenTerminalActive).toBe(true);
    expect(result.current.fullscreenOutputStart).toBe(preClaudeOutputLength);
    expect(invokeMock).not.toHaveBeenCalledWith("write_input", {
      sessionId: "session-1",
      data: "claude --continue\n",
    });

    act(() => {
      result.current.notifyFullscreenReady(120, 40);
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("resize_pty", {
        sessionId: "session-1",
        cols: 120,
        rows: 40,
      });
      expect(invokeMock).toHaveBeenCalledWith("write_input", {
        sessionId: "session-1",
        data: "claude --continue\n",
      });
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "raw_output",
          session_id: "session-1",
          data: "claude --continue\r\n",
        },
      });
    });

    const preCommandStartLength = result.current.rawOutput.length;

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "command_start",
          exit_code: null,
        },
      });
    });

    expect(result.current.fullscreenOutputStart).toBe(preCommandStartLength);
    const activeBlock = result.current.blocks[result.current.blocks.length - 1];
    expect(activeBlock?.command).toBe("claude --continue");

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "raw_output",
          session_id: "session-1",
          data: "\u001b[2Kclaude ui\n",
        },
      });
    });

    expect(result.current.rawOutput).toContain("claude ui");
    expect(activeBlock?.output ?? "").toBe("");

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "command_end",
          exit_code: 0,
        },
      });
    });

    expect(result.current.isInteractiveCommandActive).toBe(false);
    expect(result.current.interactiveCommandKind).toBeNull();
    expect(result.current.isFullscreenTerminalActive).toBe(false);
    const completedBlock = result.current.blocks[result.current.blocks.length - 1];
    expect(completedBlock?.isComplete).toBe(true);
    expect(result.current.fullscreenOutputStart).toBe(result.current.rawOutput.length);
  });

  it("recognizes path-qualified claude invocations with env prefixes", async () => {
    const { result } = renderHook(() => useTerminalSession("pane-1"));

    await waitFor(() => {
      expect(result.current.sessionId).toBe("session-1");
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "input_start",
          exit_code: null,
        },
      });
    });

    act(() => {
      result.current.sendInput("env ANTHROPIC_API_KEY=test /usr/local/bin/claude\n");
    });

    act(() => {
      result.current.notifyFullscreenReady(100, 30);
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "command_start",
          exit_code: null,
        },
      });
    });

    expect(result.current.isInteractiveCommandActive).toBe(true);
    expect(result.current.interactiveCommandKind).toBe("claude");
    expect(result.current.isFullscreenTerminalActive).toBe(true);
  });

  it("does not duplicate fullscreen raw output when parsed output also arrives", async () => {
    const { result } = renderHook(() => useTerminalSession("pane-1"));

    await waitFor(() => {
      expect(result.current.sessionId).toBe("session-1");
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "input_start",
          exit_code: null,
        },
      });
    });

    act(() => {
      result.current.sendInput("claude\n");
      result.current.notifyFullscreenReady(120, 40);
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "block",
          session_id: "session-1",
          event_type: "command_start",
          exit_code: null,
        },
      });
    });

    act(() => {
      terminalEventListener?.({
        payload: {
          kind: "raw_output",
          session_id: "session-1",
          data: "Claude Code\n",
        },
      });
      terminalEventListener?.({
        payload: {
          kind: "output",
          session_id: "session-1",
          data: "Claude Code\n",
        },
      });
    });

    expect(result.current.rawOutput).toBe("Claude Code\n");
    const block = result.current.blocks[result.current.blocks.length - 1];
    expect(block?.output ?? "").toBe("");
  });
});
