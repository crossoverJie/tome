import { useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getRootDiagnosticsSnapshot, logDiagnostics } from "../utils/diagnostics";
import "@xterm/xterm/css/xterm.css";

interface XtermCoreLike {
  _bufferService?: XtermBufferServiceLike;
  _renderService?: {
    dimensions?: {
      css?: {
        cell?: {
          width: number;
          height: number;
        };
      };
    };
  };
}

interface XtermBufferLineLike {
  isWrapped?: boolean;
}

interface XtermBufferLinesLike {
  length: number;
  get(index: number): XtermBufferLineLike | undefined;
}

interface XtermBufferLike {
  x: number;
  y: number;
  ybase: number;
  ydisp: number;
  hasScrollback: boolean;
  lines: XtermBufferLinesLike;
  translateBufferLineToString(
    lineIndex: number,
    trimRight: boolean,
    startCol?: number,
    endCol?: number
  ): string;
}

interface XtermBufferServiceLike {
  cols: number;
  rows: number;
  buffer: XtermBufferLike;
}

const ESC = "\x1b";

function repeat(count: number, value: string): string {
  return value.repeat(Math.max(0, Math.floor(count)));
}

function directionSequence(direction: "A" | "B" | "C" | "D", applicationCursor: boolean): string {
  return `${ESC}${applicationCursor ? "O" : "["}${direction}`;
}

function verticalDirection(startY: number, targetY: number): "A" | "B" {
  return startY > targetY ? "A" : "B";
}

function wrappedRowsForRow(currentRow: number, bufferService: XtermBufferServiceLike): number {
  let rowCount = 0;
  let row = currentRow;
  let line = bufferService.buffer.lines.get(row);

  while (line?.isWrapped && row >= 0 && row < bufferService.rows) {
    rowCount += 1;
    row -= 1;
    line = bufferService.buffer.lines.get(row);
  }

  return rowCount;
}

function wrappedRowsCount(
  startY: number,
  targetY: number,
  bufferService: XtermBufferServiceLike
): number {
  let wrappedRows = 0;
  const startRow = startY - wrappedRowsForRow(startY, bufferService);
  const endRow = targetY - wrappedRowsForRow(targetY, bufferService);

  for (let i = 0; i < Math.abs(startRow - endRow); i += 1) {
    const direction = verticalDirection(startY, targetY) === "A" ? -1 : 1;
    const line = bufferService.buffer.lines.get(startRow + direction * i);
    if (line?.isWrapped) {
      wrappedRows += 1;
    }
  }

  return wrappedRows;
}

function moveToRequestedRow(
  startY: number,
  targetY: number,
  bufferService: XtermBufferServiceLike,
  applicationCursor: boolean
): string {
  const startRow = startY - wrappedRowsForRow(startY, bufferService);
  const endRow = targetY - wrappedRowsForRow(targetY, bufferService);
  const rowsToMove = Math.abs(startRow - endRow) - wrappedRowsCount(startY, targetY, bufferService);
  return repeat(
    rowsToMove,
    directionSequence(verticalDirection(startY, targetY), applicationCursor)
  );
}

function bufferLine(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  forward: boolean,
  bufferService: XtermBufferServiceLike
): string {
  let currentCol = startCol;
  let currentRow = startRow;
  let currentStartCol = startCol;
  let bufferStr = "";

  while (
    (currentCol !== endCol || currentRow !== endRow) &&
    currentRow >= 0 &&
    currentRow < bufferService.buffer.lines.length
  ) {
    currentCol += forward ? 1 : -1;

    if (forward && currentCol > bufferService.cols - 1) {
      bufferStr += bufferService.buffer.translateBufferLineToString(
        currentRow,
        false,
        currentStartCol,
        currentCol
      );
      currentCol = 0;
      currentStartCol = 0;
      currentRow += 1;
    } else if (!forward && currentCol < 0) {
      bufferStr += bufferService.buffer.translateBufferLineToString(
        currentRow,
        false,
        0,
        currentStartCol + 1
      );
      currentCol = bufferService.cols - 1;
      currentStartCol = currentCol;
      currentRow -= 1;
    }
  }

  return (
    bufferStr +
    bufferService.buffer.translateBufferLineToString(currentRow, false, currentStartCol, currentCol)
  );
}

function horizontalDirection(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  bufferService: XtermBufferServiceLike,
  applicationCursor: boolean
): "C" | "D" {
  const startRow =
    moveToRequestedRow(startY, targetY, bufferService, applicationCursor).length > 0
      ? targetY - wrappedRowsForRow(targetY, bufferService)
      : startY;

  if ((startX < targetX && startRow <= targetY) || (startX >= targetX && startRow < targetY)) {
    return "C";
  }
  return "D";
}

function resetStartingRow(
  startX: number,
  startY: number,
  targetY: number,
  bufferService: XtermBufferServiceLike,
  applicationCursor: boolean
): string {
  if (moveToRequestedRow(startY, targetY, bufferService, applicationCursor).length === 0) {
    return "";
  }

  return repeat(
    bufferLine(
      startX,
      startY,
      startX,
      startY - wrappedRowsForRow(startY, bufferService),
      false,
      bufferService
    ).length,
    directionSequence("D", applicationCursor)
  );
}

function moveToRequestedCol(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  bufferService: XtermBufferServiceLike,
  applicationCursor: boolean
): string {
  const startRow =
    moveToRequestedRow(startY, targetY, bufferService, applicationCursor).length > 0
      ? targetY - wrappedRowsForRow(targetY, bufferService)
      : startY;

  const direction = horizontalDirection(
    startX,
    startY,
    targetX,
    targetY,
    bufferService,
    applicationCursor
  );

  return repeat(
    bufferLine(startX, startRow, targetX, targetY, direction === "C", bufferService).length,
    directionSequence(direction, applicationCursor)
  );
}

function moveToCellSequence(
  targetX: number,
  targetY: number,
  bufferService: XtermBufferServiceLike,
  applicationCursor: boolean
): string {
  const startX = bufferService.buffer.x;
  const startY = bufferService.buffer.y;

  if (!bufferService.buffer.hasScrollback) {
    return (
      resetStartingRow(startX, startY, targetY, bufferService, applicationCursor) +
      moveToRequestedRow(startY, targetY, bufferService, applicationCursor) +
      moveToRequestedCol(startX, startY, targetX, targetY, bufferService, applicationCursor)
    );
  }

  if (startY === targetY) {
    const direction = startX > targetX ? "D" : "C";
    return repeat(Math.abs(startX - targetX), directionSequence(direction, applicationCursor));
  }

  const direction = startY > targetY ? "D" : "C";
  const rowDifference = Math.abs(startY - targetY);
  const colsFromRowEnd = bufferService.cols - (startY > targetY ? targetX : startX);
  const colsFromRowBeginning = (startY > targetY ? startX : targetX) - 1;
  const cellsToMove =
    colsFromRowEnd + (rowDifference - 1) * bufferService.cols + 1 + colsFromRowBeginning;
  return repeat(cellsToMove, directionSequence(direction, applicationCursor));
}

function getMoveToCellSequenceForClick(
  terminal: Terminal,
  row: number,
  col: number
): string | null {
  const terminalWithCore = terminal as Terminal & { _core?: XtermCoreLike };
  const bufferService = terminalWithCore._core?._bufferService;
  if (!bufferService) {
    return null;
  }

  return moveToCellSequence(
    col - 1,
    row - 1,
    bufferService,
    Boolean(terminal.modes.applicationCursorKeysMode)
  );
}

function getCoordsRelativeToElement(
  event: MouseEvent,
  element: HTMLElement
): [number, number] | undefined {
  const rect = element.getBoundingClientRect();
  const elementStyle = window.getComputedStyle(element);
  const leftPadding = Number.parseInt(elementStyle.getPropertyValue("padding-left"), 10) || 0;
  const topPadding = Number.parseInt(elementStyle.getPropertyValue("padding-top"), 10) || 0;

  return [event.clientX - rect.left - leftPadding, event.clientY - rect.top - topPadding];
}

function getTerminalClickCoords(
  terminal: Terminal,
  container: HTMLDivElement,
  event: MouseEvent
): { row: number; col: number } | null {
  const screenElement =
    container.querySelector<HTMLElement>(".xterm-screen") ??
    container.querySelector<HTMLElement>(".xterm");
  const core = (terminal as Terminal & { _core?: XtermCoreLike })._core;
  const cssCellWidth = core?._renderService?.dimensions?.css?.cell?.width;
  const cssCellHeight = core?._renderService?.dimensions?.css?.cell?.height;

  if (
    screenElement &&
    cssCellWidth &&
    cssCellHeight &&
    cssCellWidth > 0 &&
    cssCellHeight > 0 &&
    terminal.cols > 0 &&
    terminal.rows > 0
  ) {
    const coords = getCoordsRelativeToElement(event, screenElement);
    if (!coords) {
      return null;
    }

    const col = Math.min(
      Math.max(Math.ceil((coords[0] + cssCellWidth / 2) / cssCellWidth), 1),
      terminal.cols + 1
    );
    const row = Math.min(Math.max(Math.ceil(coords[1] / cssCellHeight), 1), terminal.rows);
    return { row, col };
  }

  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || terminal.cols <= 0 || terminal.rows <= 0) {
    return null;
  }

  const cellWidth = rect.width / terminal.cols;
  const cellHeight = rect.height / terminal.rows;
  return {
    col: Math.min(
      terminal.cols + 1,
      Math.max(1, Math.ceil((event.clientX - rect.left) / cellWidth))
    ),
    row: Math.min(terminal.rows, Math.max(1, Math.ceil((event.clientY - rect.top) / cellHeight))),
  };
}

interface FullscreenTerminalProps {
  sessionId: string | null;
  visible: boolean;
  isFocused: boolean;
  startOffset: number;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (cols: number, rows: number) => void;
  rawOutput: string;
  interactiveCommandKind?: "claude" | "copilot" | null;
}

interface TerminalHost {
  hostId: number;
  element: HTMLDivElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  disposeTimer: number | null;
  hydrated: boolean;
  lastWritten: number;
  startOffset: number;
  handleData: (data: string) => void;
  handleResize: (cols: number, rows: number) => void;
  handleKeyEvent: (event: KeyboardEvent) => boolean;
  handleMouseUp: (event: MouseEvent) => void;
  handleMouseDown: (event: MouseEvent) => void;
}

const TERMINAL_HOST_GRACE_MS = 2000;
const terminalHostCache = new Map<string, TerminalHost>();
let nextTerminalHostId = 1;

function createTerminalHost(): TerminalHost {
  const element = document.createElement("div");
  element.className = "fullscreen-terminal-host";

  const terminal = new Terminal({
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: 14,
    theme: {
      background: "#1a1a2e",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
    },
    altClickMovesCursor: false,
    cursorBlink: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(element);

  const host: TerminalHost = {
    hostId: nextTerminalHostId,
    element,
    terminal,
    fitAddon,
    disposeTimer: null,
    hydrated: false,
    lastWritten: 0,
    startOffset: 0,
    handleData: () => {},
    handleResize: () => {},
    handleKeyEvent: () => true,
    handleMouseUp: () => {},
    handleMouseDown: () => {},
  };
  nextTerminalHostId += 1;

  terminal.onData((data) => host.handleData(data));
  terminal.onResize(({ cols, rows }) => host.handleResize(cols, rows));
  terminal.attachCustomKeyEventHandler((event) => host.handleKeyEvent(event));
  element.addEventListener("mouseup", (event) => host.handleMouseUp(event), true);
  element.addEventListener("mousedown", (event) => host.handleMouseDown(event), true);

  logDiagnostics("FullscreenTerminal", "host-create", {
    hostId: host.hostId,
    terminalCols: terminal.cols,
    terminalRows: terminal.rows,
  });

  return host;
}

function acquireTerminalHost(sessionId: string): TerminalHost {
  const cachedHost = terminalHostCache.get(sessionId);
  if (cachedHost) {
    if (cachedHost.disposeTimer !== null) {
      window.clearTimeout(cachedHost.disposeTimer);
      cachedHost.disposeTimer = null;
    }
    logDiagnostics("FullscreenTerminal", "host-acquire", {
      sessionId,
      hostId: cachedHost.hostId,
      reused: true,
      hostConnected: cachedHost.element.isConnected,
    });
    return cachedHost;
  }

  const host = createTerminalHost();
  terminalHostCache.set(sessionId, host);
  logDiagnostics("FullscreenTerminal", "host-acquire", {
    sessionId,
    hostId: host.hostId,
    reused: false,
    hostConnected: host.element.isConnected,
  });
  return host;
}

function releaseTerminalHost(sessionId: string) {
  const host = terminalHostCache.get(sessionId);
  if (!host || host.disposeTimer !== null) {
    return;
  }

  logDiagnostics("FullscreenTerminal", "host-release-scheduled", {
    sessionId,
    hostId: host.hostId,
    graceMs: TERMINAL_HOST_GRACE_MS,
    hostConnected: host.element.isConnected,
  });

  host.disposeTimer = window.setTimeout(() => {
    host.disposeTimer = null;
    host.terminal.dispose();
    terminalHostCache.delete(sessionId);
    logDiagnostics("FullscreenTerminal", "host-disposed", {
      sessionId,
      hostId: host.hostId,
    });
  }, TERMINAL_HOST_GRACE_MS);
}

export function resetFullscreenTerminalHostsForTest() {
  for (const host of terminalHostCache.values()) {
    if (host.disposeTimer !== null) {
      window.clearTimeout(host.disposeTimer);
    }
    host.terminal.dispose();
  }
  terminalHostCache.clear();
}

export function FullscreenTerminal({
  sessionId,
  visible,
  isFocused,
  startOffset,
  onData,
  onResize,
  onReady,
  rawOutput,
  interactiveCommandKind = null,
}: FullscreenTerminalProps) {
  const claudeRetryBudget = 24;
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<TerminalHost | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastWrittenRef = useRef(0);
  const isHydratedRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  const rawOutputRef = useRef(rawOutput);
  const pendingProbeRef = useRef<{ setAnchor: boolean; buffer: string } | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const claudeRetryTimeoutRef = useRef<number | null>(null);
  const activationFrameRef = useRef<number | null>(null);

  const createTerminalDiagnosticsSnapshot = useCallback(
    (reason: string) => {
      const host = hostRef.current;
      const terminal = terminalRef.current;
      const container = containerRef.current;
      return {
        reason,
        sessionId,
        visible,
        isFocused: isFocusedRef.current,
        interactiveCommandKind,
        hostId: host?.hostId ?? null,
        hostHydrated: host?.hydrated ?? null,
        hostStartOffset: host?.startOffset ?? null,
        hostLastWritten: host?.lastWritten ?? null,
        hostConnected: host?.element.isConnected ?? false,
        hostParentClass:
          typeof host?.element.parentElement?.className === "string"
            ? host.element.parentElement.className
            : null,
        containerWidth: container?.clientWidth ?? null,
        containerHeight: container?.clientHeight ?? null,
        terminalCols: terminal?.cols ?? null,
        terminalRows: terminal?.rows ?? null,
        rawOutputLength: rawOutputRef.current.length,
        ...getRootDiagnosticsSnapshot(),
      };
    },
    [interactiveCommandKind, sessionId, visible]
  );

  const fitTerminal = useCallback(() => {
    hostRef.current?.fitAddon.fit();
  }, []);

  const clearActivationFrame = useCallback(() => {
    if (activationFrameRef.current !== null) {
      window.cancelAnimationFrame(activationFrameRef.current);
      activationFrameRef.current = null;
    }
  }, []);

  const reportTerminalCursor = useCallback(
    async (setAnchor: boolean) => {
      if (
        !sessionId ||
        !terminalRef.current ||
        terminalRef.current.buffer.active.type === "alternate"
      ) {
        return false;
      }
      const { cursorX, cursorY } = terminalRef.current.buffer.active;
      return invoke<boolean>("report_cursor_position", {
        sessionId,
        row: cursorY + 1,
        col: cursorX + 1,
        setAnchor,
      });
    },
    [sessionId]
  );

  const clearClaudeRetryTimeout = useCallback(() => {
    if (claudeRetryTimeoutRef.current !== null) {
      window.clearTimeout(claudeRetryTimeoutRef.current);
      claudeRetryTimeoutRef.current = null;
    }
  }, []);

  const focusTerminal = useCallback(
    (setAnchor: boolean) => {
      if (!visible || !terminalRef.current) {
        return;
      }

      logDiagnostics(
        "FullscreenTerminal",
        "focus-terminal",
        createTerminalDiagnosticsSnapshot(`focus-terminal:setAnchor=${String(setAnchor)}`)
      );
      terminalRef.current.focus();
      void reportTerminalCursor(setAnchor);
    },
    [createTerminalDiagnosticsSnapshot, reportTerminalCursor, visible]
  );

  const redrawTerminal = useCallback(
    (source: string, setAnchor: boolean) => {
      const terminal = terminalRef.current;
      if (!visible || !terminal) {
        return;
      }

      logDiagnostics("FullscreenTerminal", "redraw-terminal", {
        source,
        setAnchor,
        ...createTerminalDiagnosticsSnapshot(`redraw:${source}`),
      });
      fitTerminal();
      terminal.refresh(0, Math.max(terminal.rows - 1, 0));
      if (isFocusedRef.current) {
        focusTerminal(setAnchor);
        return;
      }

      void reportTerminalCursor(setAnchor);
    },
    [createTerminalDiagnosticsSnapshot, fitTerminal, focusTerminal, reportTerminalCursor, visible]
  );

  const scheduleClaudeCursorCorrection = useCallback(
    (retriesRemaining: number) => {
      clearClaudeRetryTimeout();
      if (retriesRemaining <= 0) {
        return;
      }

      claudeRetryTimeoutRef.current = window.setTimeout(() => {
        claudeRetryTimeoutRef.current = null;
        reportTerminalCursor(false)
          .then((shouldContinue) => {
            if (shouldContinue) {
              scheduleClaudeCursorCorrection(retriesRemaining - 1);
            }
          })
          .catch(() => {
            clearClaudeRetryTimeout();
          });
      }, 48);
    },
    [clearClaudeRetryTimeout, reportTerminalCursor]
  );

  const requestCursorProbe = useCallback(
    (setAnchor: boolean) => {
      if (
        !sessionId ||
        !terminalRef.current ||
        terminalRef.current.buffer.active.type === "alternate"
      ) {
        return;
      }

      pendingProbeRef.current = { setAnchor, buffer: "" };
      terminalRef.current.write("\x1b[6n");
    },
    [sessionId]
  );

  const handleTerminalMouseUp = useCallback(
    (event: MouseEvent) => {
      const terminal = terminalRef.current;
      const container = hostRef.current?.element;
      const pointerDown = pointerDownRef.current;
      pointerDownRef.current = null;

      if (
        !visible ||
        !sessionId ||
        !terminal ||
        !container ||
        terminal.buffer.active.type === "alternate" ||
        event.button !== 0 ||
        !pointerDown
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();

      const movedDistance = Math.hypot(
        event.clientX - pointerDown.x,
        event.clientY - pointerDown.y
      );
      if (movedDistance > 4) {
        return;
      }

      const coords = getTerminalClickCoords(terminal, container, event);
      if (!coords) {
        return;
      }

      const sequence =
        interactiveCommandKind === "claude"
          ? null
          : getMoveToCellSequenceForClick(terminal, coords.row, coords.col);
      if (sequence && interactiveCommandKind !== "claude") {
        onData(sequence);
        return;
      }

      void invoke("move_cursor_to_position", {
        sessionId,
        row: coords.row,
        col: coords.col,
        staged: interactiveCommandKind === "claude",
      }).then(() => {
        if (interactiveCommandKind === "claude") {
          scheduleClaudeCursorCorrection(claudeRetryBudget);
          return;
        }

        window.setTimeout(() => requestCursorProbe(false), 16);
      });
    },
    [
      interactiveCommandKind,
      onData,
      requestCursorProbe,
      scheduleClaudeCursorCorrection,
      sessionId,
      visible,
    ]
  );

  const handleTerminalMouseDown = useCallback(
    (event: MouseEvent) => {
      if (
        !visible ||
        !sessionId ||
        !terminalRef.current ||
        terminalRef.current.buffer.active.type === "alternate" ||
        event.button !== 0
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
    },
    [sessionId, visible]
  );

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    rawOutputRef.current = rawOutput;
  }, [rawOutput]);

  useEffect(() => {
    logDiagnostics(
      "FullscreenTerminal",
      "state-change",
      createTerminalDiagnosticsSnapshot("state-change")
    );
  }, [createTerminalDiagnosticsSnapshot, isFocused, rawOutput.length, sessionId, visible]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) {
      terminalRef.current = null;
      fitAddonRef.current = null;
      hostRef.current = null;
      return;
    }

    const host = acquireTerminalHost(sessionId);
    hostRef.current = host;
    terminalRef.current = host.terminal;
    fitAddonRef.current = host.fitAddon;
    container.replaceChildren(host.element);
    logDiagnostics("FullscreenTerminal", "host-attached", {
      ...createTerminalDiagnosticsSnapshot("host-attached"),
      attachedHostId: host.hostId,
    });

    return () => {
      clearClaudeRetryTimeout();
      pendingProbeRef.current = null;
      clearActivationFrame();
      if (host.element.parentElement === container) {
        container.removeChild(host.element);
      }
      logDiagnostics("FullscreenTerminal", "host-detached", {
        ...createTerminalDiagnosticsSnapshot("host-detached"),
        detachedHostId: host.hostId,
      });
      releaseTerminalHost(sessionId);
      hostRef.current = null;
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    clearActivationFrame,
    clearClaudeRetryTimeout,
    fitTerminal,
    handleTerminalMouseDown,
    handleTerminalMouseUp,
    sessionId,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    host.handleData = (data: string) => {
      const pendingProbe = pendingProbeRef.current;
      if (pendingProbe) {
        const nextBuffer = pendingProbe.buffer + data;
        const match = /^\x1b\[(\d+);(\d+)R$/.exec(nextBuffer);
        if (match) {
          pendingProbeRef.current = null;
          void invoke<boolean>("report_cursor_position", {
            sessionId,
            row: Number(match[1]),
            col: Number(match[2]),
            setAnchor: pendingProbe.setAnchor,
          }).then((shouldProbeAgain) => {
            if (shouldProbeAgain) {
              window.setTimeout(() => requestCursorProbe(false), 16);
            }
          });
          return;
        }

        if (/^\x1b\[(\d*;?\d*)?R?$/.test(nextBuffer)) {
          pendingProbeRef.current = { ...pendingProbe, buffer: nextBuffer };
          return;
        }

        pendingProbeRef.current = null;
        onData(nextBuffer);
        return;
      }

      onData(data);
    };

    host.handleResize = (cols: number, rows: number) => {
      onResize(cols, rows);
    };

    host.handleKeyEvent = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "Backspace") {
        onData("\x15");
        return false;
      }
      if (event.metaKey && event.key === "ArrowLeft") {
        onData("\x01");
        return false;
      }
      if (event.metaKey && event.key === "ArrowRight") {
        onData("\x05");
        return false;
      }
      if (event.shiftKey && event.key === "Enter") {
        if (event.type !== "keydown") {
          return false;
        }
        onData("\x1b[13;2u");
        return false;
      }
      return true;
    };

    host.handleMouseUp = handleTerminalMouseUp;
    host.handleMouseDown = handleTerminalMouseDown;
  }, [
    handleTerminalMouseDown,
    handleTerminalMouseUp,
    onData,
    onResize,
    requestCursorProbe,
    sessionId,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (visible && host) {
      clearActivationFrame();
      clearClaudeRetryTimeout();
      if (!host.hydrated || host.startOffset !== startOffset) {
        host.hydrated = false;
        isHydratedRef.current = false;
        host.terminal.reset();
        host.lastWritten = startOffset;
        lastWrittenRef.current = startOffset;
        logDiagnostics("FullscreenTerminal", "hydrate-reset", {
          ...createTerminalDiagnosticsSnapshot("hydrate-reset"),
          nextStartOffset: startOffset,
        });
      }
      const activateWhenSized = (attemptsRemaining: number) => {
        const container = containerRef.current;
        if (!container || !hostRef.current) {
          activationFrameRef.current = null;
          return;
        }

        if ((container.clientWidth <= 0 || container.clientHeight <= 0) && attemptsRemaining > 0) {
          logDiagnostics("FullscreenTerminal", "activate-waiting-for-size", {
            ...createTerminalDiagnosticsSnapshot("activate-waiting-for-size"),
            attemptsRemaining,
          });
          activationFrameRef.current = window.requestAnimationFrame(() =>
            activateWhenSized(attemptsRemaining - 1)
          );
          return;
        }

        activationFrameRef.current = null;
        fitTerminal();
        if (!host.hydrated || host.startOffset !== startOffset) {
          const initialData = rawOutputRef.current.slice(startOffset);
          if (initialData.length > 0) {
            host.terminal.write(initialData);
          }
        } else if (rawOutputRef.current.length > host.lastWritten) {
          host.terminal.write(rawOutputRef.current.slice(host.lastWritten));
        }
        host.lastWritten = rawOutputRef.current.length;
        host.startOffset = startOffset;
        host.hydrated = true;
        lastWrittenRef.current = host.lastWritten;
        isHydratedRef.current = true;
        logDiagnostics("FullscreenTerminal", "hydrate-complete", {
          ...createTerminalDiagnosticsSnapshot("hydrate-complete"),
          initialWriteLength: rawOutputRef.current.length - startOffset,
        });
        onReady(host.terminal.cols, host.terminal.rows);
        if (isFocusedRef.current) {
          focusTerminal(true);
        }
      };

      activationFrameRef.current = window.requestAnimationFrame(() => activateWhenSized(8));

      return () => {
        clearActivationFrame();
      };
    } else if (sessionId) {
      clearActivationFrame();
      clearClaudeRetryTimeout();
      const currentHost = hostRef.current;
      if (currentHost) {
        currentHost.hydrated = false;
        currentHost.startOffset = -1;
      }
      isHydratedRef.current = false;
      void invoke("clear_interactive_input_anchor", { sessionId });
    }
  }, [
    clearActivationFrame,
    clearClaudeRetryTimeout,
    fitTerminal,
    onReady,
    sessionId,
    startOffset,
    focusTerminal,
    visible,
  ]);

  useEffect(() => {
    if (
      visible &&
      isHydratedRef.current &&
      terminalRef.current &&
      rawOutput.length > lastWrittenRef.current
    ) {
      const newData = rawOutput.slice(lastWrittenRef.current);
      terminalRef.current.write(newData);
      if (hostRef.current) {
        hostRef.current.lastWritten = rawOutput.length;
      }
      lastWrittenRef.current = rawOutput.length;
    }
  }, [visible, rawOutput]);

  useEffect(() => {
    const handleResize = () => {
      if (visible && terminalRef.current) {
        redrawTerminal("window.resize", false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [redrawTerminal, visible]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!visible) {
        return;
      }

      redrawTerminal("observer.resize", false);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [redrawTerminal, visible]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      redrawTerminal("document.visibilitychange", true);
    };

    const handleWindowFocus = () => {
      redrawTerminal("window.focus", true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [redrawTerminal]);

  useEffect(() => {
    if (!sessionId || !visible) {
      return;
    }

    if (!isFocused) {
      void invoke("clear_interactive_input_anchor", { sessionId });
      return;
    }

    if (!isHydratedRef.current) {
      return;
    }

    focusTerminal(true);
  }, [focusTerminal, isFocused, sessionId, visible]);

  return (
    <div className={`fullscreen-terminal ${visible ? "visible" : "hidden"}`} ref={containerRef} />
  );
}
