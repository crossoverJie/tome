import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunningCommandBar } from "./RunningCommandBar";
import type { RunningBlockState } from "../hooks/useTerminalSession";

describe("RunningCommandBar", () => {
  const mockOnControlInput = vi.fn();
  const mockOnFocus = vi.fn();

  const defaultProps = {
    command: "npm run dev",
    runningBlock: {
      blockId: "block-1",
      status: "streaming" as const,
      lastOutputAt: Date.now(),
      silenceMs: 0,
      hasInlineProgress: false,
    } satisfies RunningBlockState,
    onControlInput: mockOnControlInput,
    onFocus: mockOnFocus,
    isFocused: true,
    gitBranch: null,
  };

  beforeEach(() => {
    mockOnControlInput.mockClear();
    mockOnFocus.mockClear();
  });

  it("renders the running command", () => {
    render(<RunningCommandBar {...defaultProps} />);
    expect(screen.getByText("npm run dev")).toBeTruthy();
  });

  it("shows starting status when block is starting", () => {
    render(
      <RunningCommandBar
        {...defaultProps}
        runningBlock={{
          ...defaultProps.runningBlock,
          status: "starting",
        }}
      />
    );
    expect(screen.getByText("Starting...")).toBeTruthy();
  });

  it("shows idle status when block is quiet", () => {
    render(
      <RunningCommandBar
        {...defaultProps}
        runningBlock={{
          ...defaultProps.runningBlock,
          status: "quiet",
        }}
      />
    );
    expect(screen.getByText("Idle")).toBeTruthy();
  });

  it("does not show status text when streaming", () => {
    render(<RunningCommandBar {...defaultProps} />);
    expect(screen.queryByText("Starting...")).toBeNull();
    expect(screen.queryByText("Idle")).toBeNull();
  });

  it("sends Ctrl+C when Ctrl+C is pressed", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const bar = screen.getByText("npm run dev").closest(".running-command-bar");

    fireEvent.keyDown(bar!, { key: "c", ctrlKey: true });

    expect(mockOnControlInput).toHaveBeenCalledWith("\x03");
  });

  it("sends Ctrl+Z when Ctrl+Z is pressed", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const bar = screen.getByText("npm run dev").closest(".running-command-bar");

    fireEvent.keyDown(bar!, { key: "z", ctrlKey: true });

    expect(mockOnControlInput).toHaveBeenCalledWith("\x1a");
  });

  it("sends Enter when Enter is pressed", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const bar = screen.getByText("npm run dev").closest(".running-command-bar");

    fireEvent.keyDown(bar!, { key: "Enter" });

    expect(mockOnControlInput).toHaveBeenCalledWith("\r");
  });

  it("does not send control input for other keys", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const bar = screen.getByText("npm run dev").closest(".running-command-bar");

    fireEvent.keyDown(bar!, { key: "a" });

    expect(mockOnControlInput).not.toHaveBeenCalled();
  });

  it("sends Ctrl+C when interrupt button is clicked", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const button = screen.getByRole("button", { name: /interrupt/i });

    fireEvent.click(button);

    expect(mockOnControlInput).toHaveBeenCalledWith("\x03");
  });

  it("calls onFocus when clicked", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const bar = screen.getByText("npm run dev").closest(".running-command-bar");

    fireEvent.click(bar!);

    expect(mockOnFocus).toHaveBeenCalled();
  });

  it("is focusable via tabIndex", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const bar = screen.getByText("npm run dev").closest(".running-command-bar");

    expect(bar?.getAttribute("tabIndex")).toBe("0");
  });

  it("truncates long commands", () => {
    const longCommand = "a".repeat(200);
    render(<RunningCommandBar {...defaultProps} command={longCommand} />);
    expect(screen.getByText(longCommand)).toBeTruthy();
  });

  it("renders $ prompt without git branch by default", () => {
    render(<RunningCommandBar {...defaultProps} />);
    const prompt = screen.getByText("$");
    expect(prompt).toBeTruthy();
  });

  it("renders git branch when provided", () => {
    render(<RunningCommandBar {...defaultProps} gitBranch="main" />);
    expect(screen.getByText("(main)")).toBeTruthy();
  });
});
