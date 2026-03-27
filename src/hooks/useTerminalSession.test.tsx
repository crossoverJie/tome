import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllSessionState } from "./sessionState";
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
});
