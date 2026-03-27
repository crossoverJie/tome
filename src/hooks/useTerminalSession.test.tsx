import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllSessionState, setPaneSessionInitOptions } from "./sessionState";
import { useTerminalSession } from "./useTerminalSession";

type TerminalEventPayload =
  | { kind: "current_directory"; session_id: string; path: string }
  | { kind: "output"; session_id: string; data: string }
  | { kind: "block"; session_id: string; event_type: string; exit_code: number | null }
  | { kind: "alternate_screen"; session_id: string; active: boolean };

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
  beforeEach(() => {
    clearAllSessionState();
    terminalEventListener = undefined;
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
});
