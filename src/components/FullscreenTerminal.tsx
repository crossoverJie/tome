import { useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getRootDiagnosticsSnapshot, logDiagnostics } from "../utils/diagnostics";
import "@xterm/xterm/css/xterm.css";

const FULLSCREEN_SCROLLBACK_LINES = 1000;
const FULLSCREEN_WRITE_FLUSH_MS = 16;

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

function isAiAgentFullscreenInput(
  interactiveCommandKind: "claude" | "copilot" | null | undefined
): interactiveCommandKind is "claude" | "copilot" {
  return interactiveCommandKind === "claude" || interactiveCommandKind === "copilot";
}

function shouldForwardTextareaInput(
  event: InputEvent,
  interactiveCommandKind: "claude" | "copilot" | null | undefined
): boolean {
  const inputData = event.data;
  if (!isAiAgentFullscreenInput(interactiveCommandKind) || !inputData || event.isComposing) {
    return false;
  }

  if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
    return false;
  }

  return !inputData.includes("\n") && !inputData.includes("\r");
}

interface FullscreenTerminalProps {
  sessionId: string | null;
  visible: boolean;
  isFocused: boolean;
  startOffset: number;
  rawOutputBaseOffset?: number;
  getRawOutputSnapshot?: () => { rawOutput: string; rawOutputBaseOffset: number };
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (cols: number, rows: number) => void;
  rawOutput?: string;
  subscribeToRawOutput?: (listener: () => void) => () => void;
  interactiveCommandKind?: "claude" | "copilot" | null;
}

export function FullscreenTerminal({
  sessionId,
  visible,
  isFocused,
  startOffset,
  rawOutputBaseOffset = 0,
  getRawOutputSnapshot,
  onData,
  onResize,
  onReady,
  rawOutput = "",
  subscribeToRawOutput,
  interactiveCommandKind = null,
}: FullscreenTerminalProps) {
  const claudeRetryBudget = 24;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastWrittenRef = useRef(0);
  const isHydratedRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  const rawOutputRef = useRef(rawOutput);
  const rawOutputBaseOffsetRef = useRef(rawOutputBaseOffset);
  const latestTerminalSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const pendingWriteBufferRef = useRef("");
  const writeFlushTimeoutRef = useRef<number | null>(null);
  const pendingProbeRef = useRef<{ setAnchor: boolean; buffer: string } | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const claudeRetryTimeoutRef = useRef<number | null>(null);
  const activationFrameRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const writeDiagnosticsRef = useRef({
    bytes: 0,
    chunks: 0,
    lastLoggedAt: 0,
  });
  const textareaListenersRef = useRef<{
    textarea: HTMLTextAreaElement;
    keydownHandler: (e: KeyboardEvent) => void;
    compositionstartHandler: () => void;
    compositionendHandler: () => void;
    inputHandler: (e: Event) => void;
  } | null>(null);
  const recentXtermDataRef = useRef<string[]>([]);

  const createTerminalDiagnosticsSnapshot = useCallback(
    (reason: string) => ({
      reason,
      sessionId,
      visible,
      isFocused: isFocusedRef.current,
      startOffset,
      rawOutputBaseOffset: rawOutputBaseOffsetRef.current,
      rawOutputLength: rawOutputRef.current.length,
      lastWritten: lastWrittenRef.current,
      isHydrated: isHydratedRef.current,
      terminalCols: terminalRef.current?.cols ?? null,
      terminalRows: terminalRef.current?.rows ?? null,
      containerWidth: containerRef.current?.clientWidth ?? null,
      containerHeight: containerRef.current?.clientHeight ?? null,
      interactiveCommandKind,
      ...getRootDiagnosticsSnapshot(),
    }),
    [interactiveCommandKind, sessionId, startOffset, visible]
  );

  const readRawOutputSnapshot = useCallback(
    () =>
      getRawOutputSnapshot
        ? getRawOutputSnapshot()
        : {
            rawOutput,
            rawOutputBaseOffset,
          },
    [getRawOutputSnapshot, rawOutput, rawOutputBaseOffset]
  );

  useEffect(() => {
    latestTerminalSnapshotRef.current = createTerminalDiagnosticsSnapshot("latest");
  }, [createTerminalDiagnosticsSnapshot]);

  const flushWriteDiagnostics = useCallback(
    (reason: string, force = false) => {
      const stats = writeDiagnosticsRef.current;
      if (stats.chunks === 0) {
        return;
      }

      const now = Date.now();
      const shouldLog = force || stats.bytes >= 128 * 1024 || now - stats.lastLoggedAt >= 1000;
      if (!shouldLog) {
        return;
      }

      logDiagnostics("FullscreenTerminal", "write-burst", {
        ...createTerminalDiagnosticsSnapshot(reason),
        chunkCount: stats.chunks,
        totalBytes: stats.bytes,
      });
      stats.bytes = 0;
      stats.chunks = 0;
      stats.lastLoggedAt = now;
    },
    [createTerminalDiagnosticsSnapshot]
  );

  const recordTerminalWrite = useCallback(
    (byteLength: number, reason: string) => {
      const stats = writeDiagnosticsRef.current;
      stats.bytes += byteLength;
      stats.chunks += 1;
      flushWriteDiagnostics(reason);
    },
    [flushWriteDiagnostics]
  );

  const fitTerminal = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const flushPendingWrites = useCallback(
    (reason: "scheduled-flush" | "deactivate" | "unmount") => {
      if (writeFlushTimeoutRef.current !== null) {
        window.clearTimeout(writeFlushTimeoutRef.current);
        writeFlushTimeoutRef.current = null;
      }

      if (!terminalRef.current || pendingWriteBufferRef.current.length === 0) {
        return;
      }

      const pending = pendingWriteBufferRef.current;
      pendingWriteBufferRef.current = "";
      terminalRef.current.write(pending);
      recordTerminalWrite(pending.length, reason);
    },
    [recordTerminalWrite]
  );

  const enqueueTerminalWrite = useCallback(
    (data: string) => {
      if (data.length === 0) {
        return;
      }

      pendingWriteBufferRef.current += data;
      if (writeFlushTimeoutRef.current !== null) {
        return;
      }

      writeFlushTimeoutRef.current = window.setTimeout(() => {
        flushPendingWrites("scheduled-flush");
      }, FULLSCREEN_WRITE_FLUSH_MS);
    },
    [flushPendingWrites]
  );

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
        terminalRef.current.buffer.active.type === "alternate" ||
        isComposingRef.current
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

      terminalRef.current.focus();
      void reportTerminalCursor(setAnchor);
    },
    [reportTerminalCursor, visible]
  );

  const scheduleClaudeCursorCorrection = useCallback(
    (retriesRemaining: number) => {
      clearClaudeRetryTimeout();
      if (retriesRemaining <= 0) {
        return;
      }

      const delay = retriesRemaining === claudeRetryBudget ? 150 : 48;
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
      }, delay);
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
      const container = containerRef.current;
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
    const snapshot = readRawOutputSnapshot();
    rawOutputRef.current = snapshot.rawOutput;
    rawOutputBaseOffsetRef.current = snapshot.rawOutputBaseOffset;
  }, [readRawOutputSnapshot]);

  useEffect(() => {
    logDiagnostics("FullscreenTerminal", "mount", createTerminalDiagnosticsSnapshot("mount"));

    return () => {
      flushWriteDiagnostics("unmount", true);
      logDiagnostics("FullscreenTerminal", "unmount", {
        ...(latestTerminalSnapshotRef.current ?? {}),
        reason: "unmount",
      });
    };
  }, []);

  useEffect(() => {
    logDiagnostics(
      "FullscreenTerminal",
      "state-change",
      createTerminalDiagnosticsSnapshot("state-change")
    );
  }, [createTerminalDiagnosticsSnapshot]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 14,
      theme: {
        background: "#1a1a2e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
      },
      scrollback: FULLSCREEN_SCROLLBACK_LINES,
      altClickMovesCursor: false,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    terminal.onData((data) => {
      // Record recent xterm data for comparison with input events
      recentXtermDataRef.current.push(data);
      if (recentXtermDataRef.current.length > 10) {
        recentXtermDataRef.current.shift();
      }

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
    });

    terminal.onResize(({ cols, rows }) => {
      onResize(cols, rows);
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }
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
      if (event.shiftKey && event.key === "Enter" && isAiAgentFullscreenInput(interactiveCommandKind)) {
        onData("\x1b[13;2u");
        return false;
      }
      return true;
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Attach to textarea with retry logic to handle xterm's async textarea creation
    const attachToTextarea = (retriesRemaining: number): void => {
      const textarea = containerRef.current?.querySelector("textarea");
      if (textarea) {
        const keydownHandler = (e: KeyboardEvent): void => {
          if (!isAiAgentFullscreenInput(interactiveCommandKind)) {
            return;
          }

          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            onData("\x1b[13;2u");
          }
        };
        const compositionstartHandler = (): void => {
          isComposingRef.current = true;
        };
        const compositionendHandler = (): void => {
          isComposingRef.current = false;
        };
        const inputHandler = (e: Event): void => {
          if (!(e instanceof InputEvent)) return;
          const shouldForward = shouldForwardTextareaInput(e, interactiveCommandKind);
          if (!shouldForward) return;

          const inputData = e.data;
          if (!inputData) return;
          // Check if xterm already handled this input
          setTimeout(() => {
            const wasHandled = recentXtermDataRef.current.includes(inputData);
            if (!wasHandled) {
              onData(inputData);
            } else {
              // Remove from recent list to avoid false positives
              const index = recentXtermDataRef.current.indexOf(inputData);
              if (index > -1) {
                recentXtermDataRef.current.splice(index, 1);
              }
            }
          }, 10);
        };

        textarea.addEventListener("keydown", keydownHandler, true);
        textarea.addEventListener("compositionstart", compositionstartHandler);
        textarea.addEventListener("compositionend", compositionendHandler);
        textarea.addEventListener("input", inputHandler);

        textareaListenersRef.current = {
          textarea,
          keydownHandler,
          compositionstartHandler,
          compositionendHandler,
          inputHandler,
        };
      } else if (retriesRemaining > 0) {
        // Retry after a short delay
        setTimeout(() => attachToTextarea(retriesRemaining - 1), 50);
      }
    };

    // Start attachment with retry budget
    attachToTextarea(20);

    containerRef.current.addEventListener("mouseup", handleTerminalMouseUp, true);
    containerRef.current.addEventListener("mousedown", handleTerminalMouseDown, true);

    return () => {
      flushPendingWrites("unmount");
      clearClaudeRetryTimeout();
      pendingProbeRef.current = null;
      clearActivationFrame();

      // Remove textarea event listeners
      if (textareaListenersRef.current) {
        const { textarea, keydownHandler, compositionstartHandler, compositionendHandler, inputHandler } =
          textareaListenersRef.current;
        textarea.removeEventListener("keydown", keydownHandler, true);
        textarea.removeEventListener("compositionstart", compositionstartHandler);
        textarea.removeEventListener("compositionend", compositionendHandler);
        textarea.removeEventListener("input", inputHandler);
        textareaListenersRef.current = null;
      }

      // Reset composing state
      isComposingRef.current = false;

      containerRef.current?.removeEventListener("mouseup", handleTerminalMouseUp, true);
      containerRef.current?.removeEventListener("mousedown", handleTerminalMouseDown, true);
      terminal.dispose();
    };
  }, [
    clearActivationFrame,
    clearClaudeRetryTimeout,
    flushPendingWrites,
    handleTerminalMouseDown,
    handleTerminalMouseUp,
    interactiveCommandKind,
    requestCursorProbe,
    sessionId,
  ]);

  useEffect(() => {
    if (visible && fitAddonRef.current) {
      logDiagnostics(
        "FullscreenTerminal",
        "activation-start",
        createTerminalDiagnosticsSnapshot("activation-start")
      );
      clearActivationFrame();
      clearClaudeRetryTimeout();
      isHydratedRef.current = false;
      terminalRef.current?.reset();
      lastWrittenRef.current = startOffset;
      const activateWhenSized = (attemptsRemaining: number) => {
        const container = containerRef.current;
        if (!container || !terminalRef.current) {
          activationFrameRef.current = null;
          return;
        }

        if ((container.clientWidth <= 0 || container.clientHeight <= 0) && attemptsRemaining > 0) {
          logDiagnostics("FullscreenTerminal", "activation-waiting-size", {
            ...createTerminalDiagnosticsSnapshot("activation-waiting-size"),
            attemptsRemaining,
          });
          activationFrameRef.current = window.requestAnimationFrame(() =>
            activateWhenSized(attemptsRemaining - 1)
          );
          return;
        }

        activationFrameRef.current = null;
        fitTerminal();
        const bufferBaseOffset = rawOutputBaseOffsetRef.current;
        const relativeStart = Math.max(0, startOffset - bufferBaseOffset);
        if (startOffset < bufferBaseOffset) {
          console.warn("[tome] Fullscreen hydration replay was truncated", {
            startOffset,
            rawOutputBaseOffset: bufferBaseOffset,
            retainedLength: rawOutputRef.current.length,
          });
          logDiagnostics("FullscreenTerminal", "hydration-truncated", {
            ...createTerminalDiagnosticsSnapshot("hydration-truncated"),
            retainedLength: rawOutputRef.current.length,
          });
        }
        const initialData = rawOutputRef.current.slice(relativeStart);
        if (initialData.length > 0) {
          terminalRef.current.write(initialData);
          recordTerminalWrite(initialData.length, "hydration-write");
        }
        lastWrittenRef.current = bufferBaseOffset + rawOutputRef.current.length;
        isHydratedRef.current = true;
        logDiagnostics("FullscreenTerminal", "activation-complete", {
          ...createTerminalDiagnosticsSnapshot("activation-complete"),
          initialDataLength: initialData.length,
        });
        onReady(terminalRef.current.cols, terminalRef.current.rows);
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
      flushPendingWrites("deactivate");
      isHydratedRef.current = false;
      flushWriteDiagnostics("deactivate", true);
      logDiagnostics(
        "FullscreenTerminal",
        "activation-end",
        createTerminalDiagnosticsSnapshot("activation-end")
      );
      void invoke("clear_interactive_input_anchor", { sessionId });
    }
  }, [
    clearActivationFrame,
    clearClaudeRetryTimeout,
    createTerminalDiagnosticsSnapshot,
    fitTerminal,
    flushPendingWrites,
    flushWriteDiagnostics,
    onReady,
    recordTerminalWrite,
    sessionId,
    startOffset,
    focusTerminal,
    visible,
  ]);

  const processLatestRawOutput = useCallback(() => {
    const snapshot = readRawOutputSnapshot();
    rawOutputRef.current = snapshot.rawOutput;
    rawOutputBaseOffsetRef.current = snapshot.rawOutputBaseOffset;
    const absoluteEndOffset = snapshot.rawOutputBaseOffset + snapshot.rawOutput.length;

    if (
      visible &&
      isHydratedRef.current &&
      terminalRef.current &&
      absoluteEndOffset > lastWrittenRef.current
    ) {
      const relativeWriteStart = Math.max(0, lastWrittenRef.current - snapshot.rawOutputBaseOffset);
      const newData = snapshot.rawOutput.slice(relativeWriteStart);
      lastWrittenRef.current = absoluteEndOffset;
      enqueueTerminalWrite(newData);
    }
  }, [enqueueTerminalWrite, readRawOutputSnapshot, visible]);

  useEffect(() => {
    if (subscribeToRawOutput) {
      return subscribeToRawOutput(() => {
        processLatestRawOutput();
      });
    }

    processLatestRawOutput();
  }, [processLatestRawOutput, subscribeToRawOutput]);

  useEffect(() => {
    const handleResize = () => {
      if (visible && fitAddonRef.current) {
        logDiagnostics(
          "FullscreenTerminal",
          "window-resize",
          createTerminalDiagnosticsSnapshot("window-resize")
        );
        fitTerminal();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [createTerminalDiagnosticsSnapshot, fitTerminal, visible]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!visible) {
        return;
      }

      logDiagnostics(
        "FullscreenTerminal",
        "resize-observer",
        createTerminalDiagnosticsSnapshot("resize-observer")
      );
      fitTerminal();
      void reportTerminalCursor(false);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [createTerminalDiagnosticsSnapshot, fitTerminal, reportTerminalCursor, visible]);

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
