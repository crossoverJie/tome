import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  };

  return {
    attachCustomKeyEventHandler,
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
    invoke,
    terminalInstance,
    emitData: (data: string) => dataHandler?.(data),
    emitResize: (cols: number, rows: number) => resizeHandler?.({ cols, rows }),
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
    terminalMocks.terminalInstance.onData.mockClear();
    terminalMocks.terminalInstance.onResize.mockClear();
    terminalMocks.invoke.mockResolvedValue(undefined);
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
  });

  it("starts writing from the provided offset when fullscreen activates", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={false}
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
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude"}
      />
    );

    expect(terminalMocks.reset).toHaveBeenCalledOnce();
    expect(terminalMocks.write).toHaveBeenCalledWith("claude");

    act(() => {
      vi.runAllTimers();
    });

    expect(terminalMocks.fit).toHaveBeenCalled();
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
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude"}
      />
    );

    terminalMocks.write.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        startOffset={6}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"shell\nclaude/model"}
      />
    );

    expect(terminalMocks.write).toHaveBeenCalledWith("/model");
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
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={shellEcho}
      />
    );

    terminalMocks.write.mockClear();
    terminalMocks.reset.mockClear();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        startOffset={shellEcho.length}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={shellEcho}
      />
    );

    expect(terminalMocks.reset).toHaveBeenCalledOnce();
    expect(terminalMocks.write).not.toHaveBeenCalled();

    rerender(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        startOffset={shellEcho.length}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={`${shellEcho}Claude UI`}
      />
    );

    expect(terminalMocks.write).toHaveBeenCalledWith("Claude UI");
  });

  it("translates a click into frontend cursor movement first", () => {
    terminalMocks.buffer.active.cursorX = 10;
    terminalMocks.buffer.active.cursorY = 4;

    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
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
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 205, clientY: 85 })
      );
      terminalElement.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 205, clientY: 85 })
      );
    });

    expect(onData).toHaveBeenCalledWith("\x1b[C".repeat(10));
    expect(terminalMocks.invoke).not.toHaveBeenCalledWith("move_cursor_to_position", {
      sessionId: "session-1",
      row: 5,
      col: 21,
    });
  });

  it("uses backend cursor movement for Claude clicks without changing Copilot behavior", () => {
    terminalMocks.buffer.active.cursorX = 10;
    terminalMocks.buffer.active.cursorY = 4;

    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { container } = render(
      <FullscreenTerminal
        sessionId={"session-1"}
        visible={true}
        startOffset={0}
        onData={onData}
        onResize={onResize}
        onReady={onReady}
        rawOutput={"prompt"}
        interactiveCommandKind={"claude"}
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

    expect(onData).not.toHaveBeenCalledWith("\x1b[C".repeat(10));
    expect(terminalMocks.invoke).toHaveBeenCalledWith("move_cursor_to_position", {
      sessionId: "session-1",
      row: 5,
      col: 21,
      staged: true,
    });
  });
});
