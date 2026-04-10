import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { FullscreenTerminal } from "./FullscreenTerminal";

const terminalMocks = vi.hoisted(() => {
  const write = vi.fn();
  const reset = vi.fn();
  const focus = vi.fn();
  const open = vi.fn();
  const dispose = vi.fn();
  const loadAddon = vi.fn();
  const onData = vi.fn();
  const onResize = vi.fn();
  const fit = vi.fn();
  const invoke = vi.fn();
  const attachCustomKeyEventHandler = vi.fn();
  const hasSelection = vi.fn(() => false);
  const getSelection = vi.fn(() => "");
  const clearSelection = vi.fn();

  let dataHandler: ((data: string) => void) | undefined;
  let resizeHandler: ((event: { cols: number; rows: number }) => void) | undefined;
  const buffer = {
    active: {
      type: "normal" as "normal" | "alternate",
      cursorX: 0,
      cursorY: 0,
    },
  };
  const bufferService = {
    cols: 80,
    rows: 24,
    buffer: {
      x: 10,
      y: 4,
      ybase: 0,
      ydisp: 0,
      hasScrollback: true,
      lines: {
        length: 24,
        get: vi.fn(() => ({ isWrapped: false })),
      },
      translateBufferLineToString: vi.fn(() => ""),
    },
  };
  const terminalInstance = {
    cols: 80,
    rows: 24,
    buffer,
    modes: {
      applicationCursorKeysMode: false,
    },
    _core: {
      _bufferService: bufferService,
    },
    write,
    reset,
    focus,
    open,
    dispose,
    loadAddon,
    onData: vi.fn((handler: (data: string) => void) => {
      dataHandler = handler;
    }),
    onResize: vi.fn((handler: (event: { cols: number; rows: number }) => void) => {
      resizeHandler = handler;
    }),
    attachCustomKeyEventHandler,
    hasSelection,
    getSelection,
    clearSelection,
  };

  return {
    attachCustomKeyEventHandler,
    clearSelection,
    buffer,
    bufferService,
    write,
    reset,
    focus,
    open,
    dispose,
    loadAddon,
    onData,
    onResize,
    fit,
    getSelection,
    hasSelection,
    invoke,
    terminalInstance,
    emitData: (data: string) => dataHandler?.(data),
    emitResize: (cols: number, rows: number) => resizeHandler?.({ cols, rows }),
  };
});

const resizeObserverMocks = vi.hoisted(() => {
  let callback: ResizeObserverCallback | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();

  class MockResizeObserver {
    constructor(nextCallback: ResizeObserverCallback) {
      callback = nextCallback;
    }

    observe = observe;
    disconnect = disconnect;
  }

  return {
    MockResizeObserver,
    observe,
    disconnect,
    trigger(entries: ResizeObserverEntry[] = []) {
      callback?.(entries, {} as ResizeObserver);
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: terminalMocks.invoke,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(() => terminalMocks.terminalInstance),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({
    fit: terminalMocks.fit,
  })),
}));

describe("FullscreenTerminal", () => {
  const clipboardWriteText = vi.fn();

  const getCustomKeyHandler = (): ((event: KeyboardEvent) => boolean) => {
    const handler = terminalMocks.attachCustomKeyEventHandler.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf("function");
    return handler as (event: KeyboardEvent) => boolean;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    terminalMocks.write.mockReset();
    terminalMocks.reset.mockReset();
    terminalMocks.focus.mockReset();
    terminalMocks.open.mockReset();
    terminalMocks.dispose.mockReset();
    terminalMocks.loadAddon.mockReset();
    terminalMocks.fit.mockReset();
    terminalMocks.invoke.mockReset();
    terminalMocks.attachCustomKeyEventHandler.mockReset();
    terminalMocks.hasSelection.mockReset();
    terminalMocks.getSelection.mockReset();
    terminalMocks.clearSelection.mockReset();
    terminalMocks.terminalInstance.onData.mockClear();
    terminalMocks.terminalInstance.onResize.mockClear();
    terminalMocks.invoke.mockResolvedValue(undefined);
    terminalMocks.hasSelection.mockReturnValue(false);
    terminalMocks.getSelection.mockReturnValue("");
    terminalMocks.buffer.active.type = "normal";
    terminalMocks.buffer.active.cursorX = 0;
    terminalMocks.buffer.active.cursorY = 0;
    terminalMocks.terminalInstance.cols = 80;
    terminalMocks.terminalInstance.rows = 24;
    terminalMocks.bufferService.cols = 80;
    terminalMocks.bufferService.rows = 24;
    terminalMocks.bufferService.buffer.x = 10;
    terminalMocks.bufferService.buffer.y = 4;
    terminalMocks.bufferService.buffer.hasScrollback = true;
    terminalMocks.bufferService.buffer.lines.get.mockClear();
    terminalMocks.bufferService.buffer.translateBufferLineToString.mockClear();
    resizeObserverMocks.observe.mockClear();
    resizeObserverMocks.disconnect.mockClear();
    vi.stubGlobal("ResizeObserver", resizeObserverMocks.MockResizeObserver);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
  });

  it("starts writing from the provided offset when fullscreen activates", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={false}
        isFocused={false}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\n"}
      />
    );

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude"}
      />
    );

    expect(terminalMocks.reset).toHaveBeenCalledOnce();
    expect(terminalMocks.write).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });

    expect(terminalMocks.fit).toHaveBeenCalled();
    expect(terminalMocks.write).toHaveBeenCalledWith("claude");
    expect(terminalMocks.focus).toHaveBeenCalled();
    expect(terminalMocks.invoke).toHaveBeenCalledWith("report_cursor_position", {
      sessionId: "session-1",
      row: 1,
      col: 1,
      setAnchor: true,
    });
  });

  it("appends only new Claude output after activation", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude"}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    terminalMocks.write.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude/model"}
      />
    );

    expect(terminalMocks.write).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(terminalMocks.write).toHaveBeenCalledWith("/model");
  });

  it("coalesces multiple stream updates into one terminal write per flush", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude"}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    terminalMocks.write.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude/model"}
      />
    );

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude/model/status"}
      />
    );

    expect(terminalMocks.write).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(terminalMocks.write).toHaveBeenCalledTimes(1);
    expect(terminalMocks.write).toHaveBeenCalledWith("/model/status");
  });

  it("streams updates from a raw output subscription without rerendering props", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();
    let notifyRawOutput: (() => void) | undefined;
    let snapshot = {
      rawOutput: "shell\nclaude",
      rawOutputBaseOffset: 0,
    };

    render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        getRawOutputSnapshot={() => snapshot}
        subscribeToRawOutput={(listener) => {
          notifyRawOutput = listener;
          return () => {
            notifyRawOutput = undefined;
          };
        }}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    terminalMocks.write.mockClear();
    snapshot = {
      rawOutput: "shell\nclaude/model",
      rawOutputBaseOffset: 0,
    };

    act(() => {
      notifyRawOutput?.();
    });

    expect(terminalMocks.write).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(terminalMocks.write).toHaveBeenCalledWith("/model");
  });

  it("creates the fullscreen xterm with a conservative scrollback cap", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"claude ui"}
      />
    );

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        scrollback: 1000,
      })
    );
  });

  it("continues streaming correctly after the retained raw output window shifts", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        rawOutputBaseOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"0123456789"}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    terminalMocks.write.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        rawOutputBaseOffset={5}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"56789abc"}
      />
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(terminalMocks.write).toHaveBeenCalledWith("abc");
  });

  it("drops shell echo when the fullscreen boundary advances after activation", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();
    const shellEcho = "shell prompt\nclaude --continue\r\n";

    const { rerender } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={shellEcho}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    terminalMocks.write.mockClear();
    terminalMocks.reset.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={shellEcho.length}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={shellEcho}
      />
    );

    expect(terminalMocks.reset).toHaveBeenCalledOnce();
    expect(terminalMocks.write).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={shellEcho.length}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={`${shellEcho}Claude UI`}
      />
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(terminalMocks.write).toHaveBeenCalledWith("Claude UI");
  });

  it("refits when the fullscreen pane container resizes", async () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"claude ui"}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    terminalMocks.fit.mockClear();
    terminalMocks.invoke.mockClear();

    await act(async () => {
      resizeObserverMocks.trigger();
    });

    expect(terminalMocks.fit).toHaveBeenCalledOnce();
    expect(terminalMocks.invoke).toHaveBeenCalledWith("report_cursor_position", {
      sessionId: "session-1",
      row: 1,
      col: 1,
      setAnchor: false,
    });
  });

  it("moves focus and anchor when pane focus changes", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={false}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"claude ui"}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    terminalMocks.focus.mockClear();
    terminalMocks.invoke.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"claude ui"}
      />
    );

    expect(terminalMocks.focus).toHaveBeenCalledOnce();
    expect(terminalMocks.invoke).toHaveBeenCalledWith("report_cursor_position", {
      sessionId: "session-1",
      row: 1,
      col: 1,
      setAnchor: true,
    });

    terminalMocks.invoke.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={false}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"claude ui"}
      />
    );

    expect(terminalMocks.invoke).toHaveBeenCalledWith("clear_interactive_input_anchor", {
      sessionId: "session-1",
    });
  });

  it("translates an Option+click into frontend cursor movement first", () => {
    terminalMocks.buffer.active.cursorX = 10;
    terminalMocks.buffer.active.cursorY = 4;

    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"prompt"}
      />
    );

    const terminalElement = container.firstElementChild as HTMLDivElement;
    vi.spyOn(terminalElement, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 480,
      top: 0,
      left: 0,
      right: 800,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    terminalMocks.invoke.mockClear();
    terminalMocks.write.mockClear();

    act(() => {
      terminalElement.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          altKey: true,
          clientX: 205,
          clientY: 85,
        })
      );
      terminalElement.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          altKey: true,
          clientX: 205,
          clientY: 85,
        })
      );
    });

    expect(onData).toHaveBeenCalledWith("\x1b[C".repeat(10));
    expect(terminalMocks.invoke).not.toHaveBeenCalledWith("move_cursor_to_position", {
      sessionId: "session-1",
      row: 5,
      col: 21,
    });
  });

  it("does not move the cursor on a plain click in fullscreen mode", () => {
    terminalMocks.buffer.active.cursorX = 10;
    terminalMocks.buffer.active.cursorY = 4;

    const onData = vi.fn();
    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"prompt"}
        aiAgentKind={"claude"}
      />
    );

    const terminalElement = container.firstElementChild as HTMLDivElement;
    vi.spyOn(terminalElement, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 480,
      top: 0,
      left: 0,
      right: 800,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    terminalMocks.invoke.mockClear();
    onData.mockClear();

    act(() => {
      terminalElement.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 205, clientY: 85 })
      );
      terminalElement.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 205, clientY: 85 })
      );
    });

    expect(onData).not.toHaveBeenCalled();
    expect(terminalMocks.invoke).not.toHaveBeenCalledWith("move_cursor_to_position", {
      sessionId: "session-1",
      row: 5,
      col: 21,
      staged: true,
    });
  });

  it("uses backend cursor movement for Claude Option+click", () => {
    terminalMocks.buffer.active.cursorX = 10;
    terminalMocks.buffer.active.cursorY = 4;

    const onData = vi.fn();
    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"prompt"}
        aiAgentKind={"claude"}
      />
    );

    const terminalElement = container.firstElementChild as HTMLDivElement;
    vi.spyOn(terminalElement, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 480,
      top: 0,
      left: 0,
      right: 800,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    terminalMocks.invoke.mockClear();
    onData.mockClear();

    act(() => {
      terminalElement.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          altKey: true,
          clientX: 205,
          clientY: 85,
        })
      );
      terminalElement.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          altKey: true,
          clientX: 205,
          clientY: 85,
        })
      );
    });

    expect(onData).not.toHaveBeenCalledWith("\x1b[C".repeat(10));
    expect(terminalMocks.invoke).toHaveBeenCalledWith("move_cursor_to_position", {
      sessionId: "session-1",
      row: 5,
      col: 21,
      staged: true,
    });
  });

  it("sends soft newline for Shift+Enter in Claude fullscreen input", () => {
    const onData = vi.fn();

    render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind={"claude"}
      />
    );

    const handled = getCustomKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      metaKey: false,
    } as KeyboardEvent);

    expect(handled).toBe(false);
    expect(onData).toHaveBeenCalledWith("\x1b[13;2u");
  });

  it("does not intercept Shift+Enter outside AI agent fullscreen input", () => {
    const onData = vi.fn();

    render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
      />
    );

    const handled = getCustomKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      metaKey: false,
    } as KeyboardEvent);

    expect(handled).toBe(true);
    expect(onData).not.toHaveBeenCalledWith("\x1b[13;2u");
  });

  it("does not replay newline textarea input for Claude fullscreen input fallback", () => {
    const onData = vi.fn();
    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind={"claude"}
      />
    );

    const terminalElement = container.firstElementChild as HTMLDivElement;
    const textarea = document.createElement("textarea");
    terminalElement.appendChild(textarea);

    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      textarea.dispatchEvent(new InputEvent("input", { data: "\n", inputType: "insertLineBreak" }));
      vi.runOnlyPendingTimers();
    });

    expect(onData).not.toHaveBeenCalledWith("\n");
  });

  it("does not replay pasted textarea input for Claude fullscreen input fallback", () => {
    const onData = vi.fn();
    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind={"claude"}
      />
    );

    const terminalElement = container.firstElementChild as HTMLDivElement;
    const textarea = document.createElement("textarea");
    terminalElement.appendChild(textarea);

    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      textarea.dispatchEvent(
        new InputEvent("input", { data: "pasted text", inputType: "insertFromPaste" })
      );
      vi.runOnlyPendingTimers();
    });

    expect(onData).not.toHaveBeenCalledWith("pasted text");
  });

  it("still replays IME punctuation text for Claude fullscreen input fallback", () => {
    const onData = vi.fn();
    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind={"claude"}
      />
    );

    const terminalElement = container.firstElementChild as HTMLDivElement;
    const textarea = document.createElement("textarea");
    terminalElement.appendChild(textarea);

    act(() => {
      vi.runAllTimers();
    });

    act(() => {
      textarea.dispatchEvent(new InputEvent("input", { data: "？", inputType: "insertText" }));
      vi.runOnlyPendingTimers();
    });

    expect(onData).toHaveBeenCalledWith("？");
  });

  it("prevents native textarea Shift+Enter submission in Claude fullscreen input", () => {
    const onData = vi.fn();
    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind={"claude"}
      />
    );

    const terminalElement = container.firstElementChild as HTMLDivElement;
    const textarea = document.createElement("textarea");
    terminalElement.appendChild(textarea);

    act(() => {
      vi.runAllTimers();
    });

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onData).toHaveBeenCalledWith("\x1b[13;2u");
  });

  it("accepts codex as AI agent for fullscreen input handling", () => {
    const onData = vi.fn();

    render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind="codex"
      />
    );

    const handled = getCustomKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      metaKey: false,
    } as KeyboardEvent);

    expect(handled).toBe(false);
    expect(onData).toHaveBeenCalledWith("\x1b[13;2u");
  });

  it("uses direct cursor policy for codex Option+click (not staged like claude)", () => {
    terminalMocks.buffer.active.cursorX = 10;
    terminalMocks.buffer.active.cursorY = 4;

    const onData = vi.fn();
    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind="codex"
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    const terminalElement = container.firstElementChild as HTMLDivElement;
    vi.spyOn(terminalElement, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 480,
      top: 0,
      left: 0,
      right: 800,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    terminalMocks.invoke.mockClear();
    onData.mockClear();

    act(() => {
      terminalElement.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          altKey: true,
          clientX: 205,
          clientY: 85,
        })
      );
      terminalElement.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          altKey: true,
          clientX: 205,
          clientY: 85,
        })
      );
    });

    // Codex uses direct cursor policy (staged: false), not staged like Claude
    // For direct policy, it sends the cursor movement sequence directly via onData
    // instead of calling the backend invoke
    expect(terminalMocks.invoke).not.toHaveBeenCalled();
    expect(onData).toHaveBeenCalled();
  });

  it("copies the terminal selection on Cmd+C without forwarding input", async () => {
    const onData = vi.fn();

    render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        isFocused={true}
        startOffset={0}
        onData={onData}
        onResize={vi.fn()}
        onReady={vi.fn()}
        rawOutput={"hello"}
        aiAgentKind="codex"
      />
    );

    terminalMocks.hasSelection.mockReturnValue(true);
    terminalMocks.getSelection.mockReturnValue("selected terminal text");

    const handled = getCustomKeyHandler()({
      type: "keydown",
      key: "c",
      code: "KeyC",
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    } as KeyboardEvent);

    expect(handled).toBe(false);
    expect(clipboardWriteText).toHaveBeenCalledWith("selected terminal text");
    expect(onData).not.toHaveBeenCalled();
  });
});
