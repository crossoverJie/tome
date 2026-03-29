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

  return {
    write,
    reset,
    focus,
    open,
    dispose,
    loadAddon,
    onData,
    onResize,
    fit,
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(() => ({
    write: terminalMocks.write,
    reset: terminalMocks.reset,
    focus: terminalMocks.focus,
    open: terminalMocks.open,
    dispose: terminalMocks.dispose,
    loadAddon: terminalMocks.loadAddon,
    onData: terminalMocks.onData,
    onResize: terminalMocks.onResize,
    attachCustomKeyEventHandler: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({
    fit: terminalMocks.fit,
  })),
}));

describe("FullscreenTerminal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(terminalMocks).forEach((mock) => mock.mockReset());
  });

  it("starts writing from the provided offset when fullscreen activates", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
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
  });

  it("appends only new Claude output after activation", () => {
    const onData = vi.fn();
    const onResize = vi.fn();
    const onReady = vi.fn();

    const { rerender } = render(
      <FullscreenTerminal
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
});
