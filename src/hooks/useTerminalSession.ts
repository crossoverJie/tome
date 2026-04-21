import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  getPaneSessionInitOptions,
  getSessionState,
  getSessionIdForPane,
  removePaneSessionInitOptions,
  setSessionState,
  setSessionIdForPane,
  updateSessionState,
  setPaneRawOutput,
  updatePaneActivity,
} from "./sessionState";
import type { CompletionResponse } from "../types/completion";
import { logDiagnostics } from "../utils/diagnostics";
import {
  createFullscreenSessionState,
  fullscreenSessionReducer,
  isFullscreenSessionActive,
  type FullscreenSessionEvent,
  type FullscreenSessionState,
  type InteractiveSessionKind,
  type AiAgentKind,
} from "../utils/fullscreenSessionState";
import {
  appendRawOutputChunk,
  FULLSCREEN_REPLAY_BUFFER_LIMIT,
  FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
  getRawOutputAbsoluteEnd,
} from "../utils/rawOutputBuffer";
import { appendTerminalOutputChunk } from "../utils/terminalOutput";

export interface Block {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: number;
  endTime: number | null;
  isComplete: boolean;
  isCollapsed: boolean;
  // Context for prompt bar display
  context?: {
    user: string;
    cwd: string;
    gitBranch: string | null;
    runtimeVersion: string | null;
    timestamp: number;
  };
}

type Phase = "prompt" | "input" | "running" | "idle";

// Pane input mode determines which component owns keyboard input
export type PaneInputMode = "editor" | "running-control" | "fullscreen-terminal";

// Running block status state machine
export type RunningBlockStatus =
  | "starting" // Just started, no output yet
  | "streaming" // Actively receiving output
  | "quiet"; // No new output for a while (but still running)

// Constants for status transitions
const SILENCE_THRESHOLD_MS = 2000; // Time before considering command "quiet"

export interface SearchResult {
  blockId: string;
  blockIndex: number;
  matchIndex: number;
  start: number;
  end: number;
  text: string;
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g) || [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

// Get current username from environment
function getCurrentUser(): string {
  // Try common environment variables for username
  return (
    import.meta.env.VITE_USER ||
    import.meta.env.USER ||
    import.meta.env.LOGNAME ||
    import.meta.env.USERNAME ||
    "user"
  );
}

interface RawOutputSnapshot {
  rawOutput: string;
  rawOutputBaseOffset: number;
}

export interface RunningBlockState {
  blockId: string | null;
  status: RunningBlockStatus;
  lastOutputAt: number;
  silenceMs: number;
  hasInlineProgress: boolean;
}

export interface InteractiveCommandDetectionResult {
  sessionKind: InteractiveSessionKind;
  aiAgentKind: AiAgentKind;
}

// Detect if a command needs fullscreen terminal interaction (REPL, AI agents, etc.)
function detectInteractiveCommand(command: string): InteractiveCommandDetectionResult | null {
  const tokens = tokenizeCommand(command.trim());
  if (tokens.length === 0) {
    return null;
  }

  let index = 0;

  if (tokens[index] === "env") {
    index += 1;
    while (index < tokens.length && isEnvAssignment(tokens[index])) {
      index += 1;
    }
  }

  while (index < tokens.length && (tokens[index] === "command" || tokens[index] === "exec")) {
    index += 1;
  }

  const executable = tokens[index];
  if (!executable) {
    return null;
  }

  const normalized = executable.endsWith("/") ? executable.slice(0, -1) : executable;
  const basename = normalized.split("/").pop();
  if (!basename) {
    return null;
  }

  // AI agents (these are always interactive regardless of arguments)
  if (basename === "claude") {
    return { sessionKind: "ai", aiAgentKind: "claude" };
  }

  if (basename === "opencode") {
    return { sessionKind: "ai", aiAgentKind: "opencode" };
  }

  // Codex: only interactive when invoked without non-interactive subcommands
  // Non-interactive subcommands: exec, completion, help, --help, --version, etc.
  if (basename === "codex") {
    const remainingTokens = tokens.slice(index + 1);
    const nonInteractiveSubcommands = new Set([
      "exec",
      "completion",
      "help",
      "--help",
      "-h",
      "--version",
      "-v",
    ]);
    const hasNonInteractiveSubcommand = remainingTokens.some((token) =>
      nonInteractiveSubcommands.has(token)
    );
    if (!hasNonInteractiveSubcommand) {
      return { sessionKind: "ai", aiAgentKind: "codex" };
    }
  }

  if (basename === "gh" && tokens[index + 1] === "copilot") {
    return { sessionKind: "ai", aiAgentKind: "copilot" };
  }

  if (
    basename === "copilot" ||
    basename === "copolit" ||
    basename === "gh-copilot" ||
    basename === "github-copilot-cli"
  ) {
    return { sessionKind: "ai", aiAgentKind: "copilot" };
  }

  // REPL commands - only when invoked without arguments (bare interpreter)
  // e.g., "python3" is interactive, but "python3 app.py" is not
  const remainingTokens = tokens.slice(index + 1);
  const hasArguments = remainingTokens.length > 0;

  if (
    !hasArguments &&
    (basename === "python" ||
      basename === "python3" ||
      basename === "ipython" ||
      basename === "ipython3" ||
      basename === "node" ||
      basename === "nodejs" ||
      basename === "bun")
  ) {
    return { sessionKind: "repl", aiAgentKind: null };
  }

  // Other REPLs that are typically interactive-only
  if (
    basename === "irb" ||
    basename === "scala" ||
    basename === "sbt" ||
    basename === "ghci" ||
    basename === "lua" ||
    basename === "lua5.1" ||
    basename === "lua5.2" ||
    basename === "lua5.3" ||
    basename === "lua5.4" ||
    basename === "ocaml" ||
    basename === "ocamlc" ||
    basename === "guile" ||
    basename === "racket" ||
    basename === "sbcl" ||
    basename === "clisp" ||
    basename === "lein" ||
    basename === "clj" ||
    basename === "nim" ||
    basename === "fsi"
  ) {
    return { sessionKind: "repl", aiAgentKind: null };
  }

  // Generic interactive TTY commands (database shells, etc.)
  // Note: intentionally excludes 'dotnet' as it's a command dispatcher
  // (dotnet build, dotnet test are non-interactive)
  if (
    basename === "psql" ||
    basename === "mysql" ||
    basename === "sqlite3" ||
    basename === "redis-cli" ||
    basename === "mongo" ||
    basename === "mongosh" ||
    basename === "rlwrap"
  ) {
    return { sessionKind: "generic", aiAgentKind: null };
  }

  return null;
}

type TerminalEvent =
  | { kind: "raw_output"; session_id: string; data: string }
  | { kind: "output"; session_id: string; data: string }
  | { kind: "block"; session_id: string; event_type: string; exit_code: number | null }
  | { kind: "alternate_screen"; session_id: string; active: boolean }
  | { kind: "current_directory"; session_id: string; path: string }
  | { kind: "git_branch"; session_id: string; branch: string | null };

interface UseTerminalSessionReturn {
  sessionId: string | null;
  blocks: Block[];
  isInputReady: boolean;
  phase: Phase;
  isAlternateScreen: boolean;
  isInteractiveCommandActive: boolean;
  interactiveSessionKind: InteractiveSessionKind | null;
  aiAgentKind: AiAgentKind;
  isFullscreenTerminalActive: boolean;
  fullscreenOutputStart: number;
  fullscreenSession: FullscreenSessionState;
  rawOutputBaseOffset: number;
  rawOutput: string;
  getRawOutputSnapshot: () => RawOutputSnapshot;
  subscribeToRawOutput: (listener: () => void) => () => void;
  currentDirectory: string | null;
  gitBranch: string | null;
  sendInput: (data: string) => void;
  requestCompletion: (text: string, cursor: number) => Promise<CompletionResponse>;
  resizePty: (cols: number, rows: number) => void;
  notifyFullscreenReady: (cols: number, rows: number) => void;
  clearBlocks: () => void;
  selectedBlockIndex: number | null;
  selectBlock: (index: number | null) => void;
  selectPrevBlock: () => void;
  selectNextBlock: () => void;
  // Collapse
  toggleBlockCollapse: (blockId: string) => void;
  // Search
  searchQuery: string;
  searchResults: SearchResult[];
  currentSearchIndex: number;
  setSearchQuery: (query: string) => void;
  nextSearchResult: () => void;
  prevSearchResult: () => void;
  clearSearch: () => void;
  // Running block state
  runningBlock: RunningBlockState | null;
  hasRunningCommand: boolean;
  // Pane input mode
  paneInputMode: PaneInputMode;
  sendControlInput: (data: string) => void;
}

const INITIAL_INPUT_READY_FALLBACK_MS = 150;
const FULLSCREEN_REPLAY_BUFFER_BUDGET = {
  limit: FULLSCREEN_REPLAY_BUFFER_LIMIT,
  trimTarget: FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
};

export function useTerminalSession(
  paneId?: string,
  existingSessionId?: string
): UseTerminalSessionReturn {
  // Get persisted session ID for this pane
  const persistedSessionId = paneId ? getSessionIdForPane(paneId) : undefined;
  const initialSessionId = existingSessionId || persistedSessionId || null;

  const [sessionId, setSessionIdState] = useState<string | null>(initialSessionId);

  // Use a ref to track if we've initialized to avoid race conditions
  const hasInitialized = useRef(false);

  // Get persisted state if available
  const persistedState = initialSessionId ? getSessionState(initialSessionId) : undefined;

  const [blocks, setBlocks] = useState<Block[]>(persistedState?.blocks || []);
  const [isInputReady, setIsInputReady] = useState(false);
  const [fullscreenSession, setFullscreenSession] = useState<FullscreenSessionState>(
    persistedState?.fullscreenSession ?? {
      ...createFullscreenSessionState(),
      sessionKind: persistedState?.interactiveSessionKind ?? null,
      aiAgentKind: persistedState?.aiAgentKind ?? null,
      startOffset: persistedState?.fullscreenOutputStart || 0,
      mode: persistedState?.isAlternateScreen
        ? "alternate"
        : persistedState?.isInteractiveCommandActive
          ? "interactive"
          : null,
      lifecycle:
        persistedState?.isAlternateScreen || persistedState?.isInteractiveCommandActive
          ? "active"
          : "inactive",
    }
  );
  const [rawOutputBaseOffset, setRawOutputBaseOffset] = useState(
    persistedState?.rawOutputBaseOffset || 0
  );
  const [rawOutput, setRawOutput] = useState(persistedState?.rawOutput || "");
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(
    persistedState?.currentDirectory || null
  );
  const [gitBranch, setGitBranch] = useState<string | null>(persistedState?.gitBranch || null);
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const currentCommandRef = useRef("");
  const pendingCommandRef = useRef("");
  const pendingClaudeLaunchRef = useRef<string | null>(null);
  const fullscreenSessionRef = useRef(fullscreenSession);
  const rawOutputRef = useRef(persistedState?.rawOutput || "");
  const rawOutputBaseOffsetRef = useRef(persistedState?.rawOutputBaseOffset || 0);
  const rawOutputListenersRef = useRef(new Set<() => void>());
  const latestSessionSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const lastTrimLogBaseOffsetRef = useRef(-1);
  const rawOutputDiagnosticsRef = useRef({
    bytes: 0,
    chunks: 0,
    lastLoggedAt: 0,
  });
  const blockIdCounter = useRef(persistedState?.blocks?.length || 0);
  const blockCountRef = useRef(persistedState?.blocks?.length || 0);
  const inputReadyFallbackRef = useRef<number | null>(null);
  const currentDirectoryRef = useRef(persistedState?.currentDirectory || null);
  const gitBranchRef = useRef(persistedState?.gitBranch || null);
  // Running block state
  const [runningBlock, setRunningBlock] = useState<RunningBlockState | null>(null);
  const runningBlockRef = useRef<RunningBlockState | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const hasRunningCommand = runningBlock !== null;
  const isFullscreenTerminalActive = isFullscreenSessionActive(fullscreenSession);
  const isAlternateScreen = fullscreenSession.mode === "alternate" && isFullscreenTerminalActive;
  const isInteractiveCommandActive =
    fullscreenSession.mode === "interactive" && isFullscreenTerminalActive;
  const interactiveSessionKind = fullscreenSession.sessionKind;
  const aiAgentKind = fullscreenSession.aiAgentKind;
  const fullscreenOutputStart = fullscreenSession.startOffset;
  const isFullscreenTerminalActiveRef = useRef(isFullscreenTerminalActive);
  isFullscreenTerminalActiveRef.current = isFullscreenTerminalActive;

  // Derive pane input mode based on session state
  const paneInputMode: PaneInputMode = isFullscreenTerminalActive
    ? "fullscreen-terminal"
    : hasRunningCommand
      ? "running-control"
      : "editor";

  // Search state
  const [searchQuery, setSearchQueryState] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);

  // Persist state whenever it changes
  useEffect(() => {
    if (sessionId) {
      updateSessionState(sessionId, {
        blocks,
        isAlternateScreen,
        isInteractiveCommandActive,
        interactiveSessionKind,
        aiAgentKind,
        fullscreenOutputStart,
        fullscreenSession,
        currentDirectory,
        gitBranch,
        ...(!isFullscreenTerminalActive
          ? {
              rawOutputBaseOffset,
              rawOutput,
            }
          : {}),
      });
    }
  }, [
    sessionId,
    blocks,
    isAlternateScreen,
    isInteractiveCommandActive,
    interactiveSessionKind,
    aiAgentKind,
    fullscreenOutputStart,
    fullscreenSession,
    isFullscreenTerminalActive,
    rawOutputBaseOffset,
    rawOutput,
    currentDirectory,
    gitBranch,
  ]);

  useEffect(() => {
    runningBlockRef.current = runningBlock;
  }, [runningBlock]);

  useEffect(() => {
    fullscreenSessionRef.current = fullscreenSession;
  }, [fullscreenSession]);

  useEffect(() => {
    rawOutputBaseOffsetRef.current = rawOutputBaseOffset;
  }, [rawOutputBaseOffset]);

  useEffect(() => {
    rawOutputRef.current = rawOutput;
  }, [rawOutput]);

  useEffect(() => {
    blockCountRef.current = blocks.length;
  }, [blocks.length]);

  useEffect(() => {
    currentDirectoryRef.current = currentDirectory;
  }, [currentDirectory]);

  useEffect(() => {
    gitBranchRef.current = gitBranch;
  }, [gitBranch]);

  const getRawOutputEndOffset = useCallback(
    () =>
      getRawOutputAbsoluteEnd({
        rawOutput: rawOutputRef.current,
        rawOutputBaseOffset: rawOutputBaseOffsetRef.current,
      }),
    []
  );

  const getRawOutputSnapshot = useCallback(
    (): RawOutputSnapshot => ({
      rawOutput: rawOutputRef.current,
      rawOutputBaseOffset: rawOutputBaseOffsetRef.current,
    }),
    []
  );

  const subscribeToRawOutput = useCallback((listener: () => void) => {
    rawOutputListenersRef.current.add(listener);
    return () => {
      rawOutputListenersRef.current.delete(listener);
    };
  }, []);

  const createSessionDiagnosticsSnapshot = useCallback(
    (reason: string) => ({
      reason,
      paneId: paneId ?? null,
      sessionId,
      phase: phaseRef.current,
      isAlternateScreen:
        fullscreenSessionRef.current.mode === "alternate" &&
        isFullscreenSessionActive(fullscreenSessionRef.current),
      isInteractiveCommandActive:
        fullscreenSessionRef.current.mode === "interactive" &&
        isFullscreenSessionActive(fullscreenSessionRef.current),
      interactiveSessionKind: fullscreenSessionRef.current.sessionKind,
      aiAgentKind: fullscreenSessionRef.current.aiAgentKind,
      rawOutputBaseOffset: rawOutputBaseOffsetRef.current,
      rawOutputLength: rawOutputRef.current.length,
      fullscreenOutputStart: fullscreenSessionRef.current.startOffset,
      blockCount: blockCountRef.current,
      currentDirectory: currentDirectoryRef.current,
      gitBranch: gitBranchRef.current,
    }),
    [paneId, sessionId]
  );

  const applyFullscreenEvent = useCallback((event: FullscreenSessionEvent) => {
    setFullscreenSession((prev) => {
      const next = fullscreenSessionReducer(prev, event);
      fullscreenSessionRef.current = next;
      return next;
    });
  }, []);

  const publishRawOutputState = useCallback(() => {
    const nextRawOutput = rawOutputRef.current;
    const nextRawOutputBaseOffset = rawOutputBaseOffsetRef.current;

    setRawOutput((prev) => (prev === nextRawOutput ? prev : nextRawOutput));
    setRawOutputBaseOffset((prev) =>
      prev === nextRawOutputBaseOffset ? prev : nextRawOutputBaseOffset
    );
  }, []);

  const scheduleRawOutputPublish = useCallback(
    (force = false) => {
      if (force || !isFullscreenTerminalActiveRef.current) {
        publishRawOutputState();
      }
    },
    [publishRawOutputState]
  );

  useEffect(() => {
    latestSessionSnapshotRef.current = createSessionDiagnosticsSnapshot("latest");
  }, [createSessionDiagnosticsSnapshot]);

  const flushRawOutputDiagnostics = useCallback(
    (reason: string, force = false) => {
      const stats = rawOutputDiagnosticsRef.current;
      if (stats.chunks === 0) {
        return;
      }

      const now = Date.now();
      const shouldLog = force || stats.bytes >= 128 * 1024 || now - stats.lastLoggedAt >= 1000;
      if (!shouldLog) {
        return;
      }

      logDiagnostics("useTerminalSession", "raw-output-burst", {
        ...createSessionDiagnosticsSnapshot(reason),
        chunkCount: stats.chunks,
        totalBytes: stats.bytes,
      });
      stats.bytes = 0;
      stats.chunks = 0;
      stats.lastLoggedAt = now;
    },
    [createSessionDiagnosticsSnapshot]
  );

  const appendRawOutput = useCallback(
    (data: string) => {
      const stats = rawOutputDiagnosticsRef.current;
      stats.bytes += data.length;
      stats.chunks += 1;

      const previousBaseOffset = rawOutputBaseOffsetRef.current;
      const next = appendRawOutputChunk(
        {
          rawOutput: rawOutputRef.current,
          rawOutputBaseOffset: previousBaseOffset,
        },
        data,
        isFullscreenTerminalActiveRef.current ? FULLSCREEN_REPLAY_BUFFER_BUDGET : undefined
      );

      rawOutputRef.current = next.rawOutput;
      rawOutputBaseOffsetRef.current = next.rawOutputBaseOffset;
      rawOutputListenersRef.current.forEach((listener) => {
        listener();
      });

      // Track raw output and activity for menu bar agent overview
      if (paneId) {
        setPaneRawOutput(paneId, rawOutputRef.current);
        updatePaneActivity(paneId);
      }

      if (next.didTrim) {
        const shouldLogTrim =
          lastTrimLogBaseOffsetRef.current < 0 ||
          next.rawOutputBaseOffset - lastTrimLogBaseOffsetRef.current >= 128 * 1024;
        if (shouldLogTrim) {
          lastTrimLogBaseOffsetRef.current = next.rawOutputBaseOffset;
          console.warn("[tome] Trimmed fullscreen raw output buffer", {
            trimmedCharCount: next.trimmedCharCount,
            rawOutputBaseOffset: next.rawOutputBaseOffset,
            fullscreenOutputStart: fullscreenSessionRef.current.startOffset,
            rawOutputLength: next.rawOutput.length,
          });
          logDiagnostics("useTerminalSession", "raw-output-trimmed", {
            ...createSessionDiagnosticsSnapshot("raw-output-trimmed"),
            trimmedCharCount: next.trimmedCharCount,
            rawOutputBaseOffset: next.rawOutputBaseOffset,
            rawOutputLength: next.rawOutput.length,
          });
        }
      }

      scheduleRawOutputPublish();
      flushRawOutputDiagnostics("raw-output-burst");
    },
    [createSessionDiagnosticsSnapshot, flushRawOutputDiagnostics, scheduleRawOutputPublish]
  );

  useEffect(() => {
    logDiagnostics("useTerminalSession", "mount", createSessionDiagnosticsSnapshot("mount"));

    return () => {
      flushRawOutputDiagnostics("unmount", true);
      logDiagnostics("useTerminalSession", "unmount", {
        ...(latestSessionSnapshotRef.current ?? {}),
        reason: "unmount",
      });
    };
  }, []);

  useEffect(() => {
    logDiagnostics(
      "useTerminalSession",
      "state-change",
      createSessionDiagnosticsSnapshot("state-change")
    );
  }, [createSessionDiagnosticsSnapshot]);

  useEffect(() => {
    // Prevent double initialization
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    let unlisten: UnlistenFn | undefined;

    const clearInputReadyFallback = () => {
      if (inputReadyFallbackRef.current !== null) {
        window.clearTimeout(inputReadyFallbackRef.current);
        inputReadyFallbackRef.current = null;
      }
    };

    const markInputReady = () => {
      clearInputReadyFallback();
      setIsInputReady(true);
    };

    async function init() {
      try {
        logDiagnostics(
          "useTerminalSession",
          "init-start",
          createSessionDiagnosticsSnapshot("init-start")
        );
        // Determine the session ID to use
        let sid: string;

        if (sessionId) {
          // Use existing session ID
          sid = sessionId;
        } else {
          // Create new session
          const initialCwd = paneId ? getPaneSessionInitOptions(paneId)?.initialCwd : undefined;
          sid = initialCwd
            ? await invoke<string>("create_session", { initialCwd })
            : await invoke<string>("create_session");
          setSessionIdState(sid);

          // Register session ID for this pane
          if (paneId) {
            setSessionIdForPane(paneId, sid);
            removePaneSessionInitOptions(paneId);
          }

          // Initialize session state
          setSessionState(sid, {
            sessionId: sid,
            blocks: [],
            isAlternateScreen: false,
            isInteractiveCommandActive: false,
            interactiveSessionKind: null,
            aiAgentKind: null,
            fullscreenOutputStart: 0,
            fullscreenSession: createFullscreenSessionState(),
            rawOutputBaseOffset: 0,
            rawOutput: "",
            currentDirectory: null,
            gitBranch: null,
          });
        }

        setIsInputReady(false);

        // Set up the event listener before making follow-up IPC calls so we don't
        // miss the shell's initial prompt/input markers during startup.
        unlisten = await listen<TerminalEvent>("terminal-event", (event) => {
          const payload = event.payload;
          if (payload.session_id !== sid) return;

          switch (payload.kind) {
            case "raw_output":
              appendRawOutput(payload.data);
              break;
            case "output": {
              const data = payload.data;

              // Only append output to block when a simple shell command is running.
              // Terminal-controlled UIs such as claude should render through xterm only.
              if (
                phaseRef.current !== "running" ||
                fullscreenSessionRef.current.mode === "alternate" ||
                fullscreenSessionRef.current.mode === "interactive"
              ) {
                return;
              }

              // Update running block state on output
              const currentRunning = runningBlockRef.current;
              if (currentRunning) {
                const now = Date.now();
                // Check for inline progress (carriage return)
                const hasInlineProgress = data.includes("\r") || currentRunning.hasInlineProgress;
                setRunningBlock({
                  ...currentRunning,
                  status: "streaming",
                  lastOutputAt: now,
                  silenceMs: 0,
                  hasInlineProgress,
                });
              }

              setBlocks((prev) => {
                const last = prev[prev.length - 1];
                if (last && !last.isComplete) {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...last,
                    output: appendTerminalOutputChunk(last.output, data),
                  };
                  return updated;
                }
                return prev;
              });
              break;
            }

            case "block": {
              const { event_type, exit_code } = payload;

              switch (event_type) {
                case "prompt_start":
                  phaseRef.current = "prompt";
                  markInputReady();
                  break;
                case "input_start":
                  phaseRef.current = "input";
                  currentCommandRef.current = "";
                  markInputReady();
                  break;
                case "command_start": {
                  phaseRef.current = "running";
                  markInputReady();
                  const cmd = pendingCommandRef.current || currentCommandRef.current;
                  const interactiveDetection = detectInteractiveCommand(cmd);
                  if (interactiveDetection) {
                    applyFullscreenEvent({
                      type: "interactive-command-started",
                      sessionKind: interactiveDetection.sessionKind,
                      aiAgentKind: interactiveDetection.aiAgentKind,
                      startOffset: getRawOutputEndOffset(),
                    });
                  }
                  pendingClaudeLaunchRef.current = null;
                  pendingCommandRef.current = "";
                  const id = `block-${++blockIdCounter.current}`;
                  const now = Date.now();
                  // Initialize running block state
                  const newRunningBlock: RunningBlockState = {
                    blockId: id,
                    status: "starting",
                    lastOutputAt: now,
                    silenceMs: 0,
                    hasInlineProgress: false,
                  };
                  setRunningBlock(newRunningBlock);
                  runningBlockRef.current = newRunningBlock;
                  // Start silence timer
                  if (silenceTimerRef.current) {
                    window.clearInterval(silenceTimerRef.current);
                  }
                  silenceTimerRef.current = window.setInterval(() => {
                    const current = runningBlockRef.current;
                    if (current && current.blockId === id) {
                      const silence = Date.now() - current.lastOutputAt;
                      let newStatus = current.status;
                      if (silence >= SILENCE_THRESHOLD_MS && current.status === "streaming") {
                        newStatus = "quiet";
                      }
                      setRunningBlock({
                        ...current,
                        silenceMs: silence,
                        status: newStatus,
                      });
                    }
                  }, 500);
                  setBlocks((prev) => [
                    ...prev,
                    {
                      id,
                      command: cmd,
                      output: "",
                      exitCode: null,
                      startTime: now,
                      endTime: null,
                      isComplete: false,
                      isCollapsed: false,
                      context: {
                        user: getCurrentUser(),
                        cwd: currentDirectoryRef.current || "~",
                        gitBranch: gitBranchRef.current,
                        runtimeVersion: null, // TODO: detect runtime version
                        timestamp: now,
                      },
                    },
                  ]);
                  logDiagnostics("useTerminalSession", "command-start", {
                    ...createSessionDiagnosticsSnapshot("command-start"),
                    command: cmd,
                    interactiveCommandActive: interactiveDetection !== null,
                    interactiveSessionKind: interactiveDetection?.sessionKind ?? null,
                    aiAgentKind: interactiveDetection?.aiAgentKind ?? null,
                  });
                  break;
                }
                case "command_end":
                  phaseRef.current = "idle";
                  pendingClaudeLaunchRef.current = null;
                  // Clear running block state and timer
                  if (silenceTimerRef.current) {
                    window.clearInterval(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                  }
                  setRunningBlock(null);
                  runningBlockRef.current = null;
                  scheduleRawOutputPublish(true);
                  applyFullscreenEvent({
                    type: "fullscreen-session-ended",
                    endOffset: getRawOutputEndOffset(),
                  });
                  setBlocks((prev) => {
                    if (prev.length === 0) return prev;
                    const updated = [...prev];
                    const last = { ...updated[updated.length - 1] };
                    last.exitCode = exit_code;
                    last.endTime = Date.now();
                    last.isComplete = true;
                    updated[updated.length - 1] = last;
                    return updated;
                  });
                  flushRawOutputDiagnostics("command-end", true);
                  logDiagnostics("useTerminalSession", "command-end", {
                    ...createSessionDiagnosticsSnapshot("command-end"),
                    exitCode: exit_code,
                  });
                  break;
              }
              break;
            }

            case "alternate_screen":
              if (payload.active) {
                applyFullscreenEvent({
                  type: "alternate-screen-entered",
                  startOffset: getRawOutputEndOffset(),
                });
              } else {
                scheduleRawOutputPublish(true);
                applyFullscreenEvent({
                  type: "alternate-screen-exited",
                  endOffset: getRawOutputEndOffset(),
                });
              }
              logDiagnostics("useTerminalSession", "alternate-screen", {
                ...createSessionDiagnosticsSnapshot("alternate-screen"),
                active: payload.active,
              });
              // When exiting alternate screen, clear the current block's output
              // to avoid showing vim's control sequences
              if (!payload.active && phaseRef.current === "running") {
                setBlocks((prev) => {
                  if (prev.length === 0) return prev;
                  const last = prev[prev.length - 1];
                  if (last && !last.isComplete) {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...last,
                      output: "",
                    };
                    return updated;
                  }
                  return prev;
                });
              }
              break;
            case "current_directory":
              setCurrentDirectory(payload.path);
              break;
            case "git_branch":
              setGitBranch(payload.branch);
              break;
          }
        });

        inputReadyFallbackRef.current = window.setTimeout(() => {
          setIsInputReady(true);
          inputReadyFallbackRef.current = null;
        }, INITIAL_INPUT_READY_FALLBACK_MS);

        const cwd = await invoke<string>("get_current_directory", { sessionId: sid });
        setCurrentDirectory(cwd);
        logDiagnostics("useTerminalSession", "init-complete", {
          ...createSessionDiagnosticsSnapshot("init-complete"),
          sessionId: sid,
          currentDirectory: cwd,
        });
      } catch (error) {
        clearInputReadyFallback();
        hasInitialized.current = false;
        console.error("Failed to initialize terminal session", error);
        logDiagnostics("useTerminalSession", "init-error", {
          ...createSessionDiagnosticsSnapshot("init-error"),
          error: error instanceof Error ? error : null,
        });
      }
    }

    void init();
    return () => {
      clearInputReadyFallback();
      unlisten?.();
    };
  }, [paneId]);

  const sendInput = useCallback(
    (data: string) => {
      if (!sessionId || !isInputReady) return;
      // Capture full command before sending to PTY (race-free)
      if (data.endsWith("\n")) {
        const cmd = data.slice(0, -1).trim();
        if (cmd) {
          pendingCommandRef.current = cmd;
          logDiagnostics("useTerminalSession", "send-input-command", {
            ...createSessionDiagnosticsSnapshot("send-input-command"),
            command: cmd,
          });
          const interactiveDetection = detectInteractiveCommand(cmd);
          if (interactiveDetection) {
            applyFullscreenEvent({
              type: "interactive-command-detected",
              sessionKind: interactiveDetection.sessionKind,
              aiAgentKind: interactiveDetection.aiAgentKind,
              startOffset: getRawOutputEndOffset(),
            });
            pendingClaudeLaunchRef.current = data;
            return;
          }
        }
      }
      if (phaseRef.current === "input") {
        currentCommandRef.current += data;
      }
      invoke("write_input", { sessionId, data });
    },
    [applyFullscreenEvent, getRawOutputEndOffset, isInputReady, sessionId]
  );

  // Send raw control bytes to PTY (e.g., \x03 for Ctrl+C, \x1a for Ctrl+Z)
  const sendControlInput = useCallback(
    (data: string) => {
      if (!sessionId || !isInputReady) return;
      invoke("write_input", { sessionId, data });
    },
    [isInputReady, sessionId]
  );

  const notifyFullscreenReady = useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;

      const pendingLaunch = pendingClaudeLaunchRef.current;
      if (!pendingLaunch || !fullscreenSessionRef.current.pendingLaunch) return;

      pendingClaudeLaunchRef.current = null;
      void invoke("resize_pty", { sessionId, cols, rows }).then(() =>
        invoke("write_input", { sessionId, data: pendingLaunch })
      );
    },
    [sessionId]
  );

  const requestCompletion = useCallback(
    async (text: string, cursor: number) => {
      if (!sessionId || !isInputReady) {
        return {
          replaceFrom: cursor,
          replaceTo: cursor,
          commonPrefix: null,
          items: [],
        };
      }

      return invoke<CompletionResponse>("request_completion", {
        sessionId,
        text,
        cursor,
      });
    },
    [isInputReady, sessionId]
  );

  const resizePty = useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;
      invoke("resize_pty", { sessionId, cols, rows });
    },
    [sessionId]
  );

  const clearBlocks = useCallback(() => {
    setBlocks([]);
    blockIdCounter.current = 0;
  }, []);

  const toggleBlockCollapse = useCallback((blockId: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, isCollapsed: !b.isCollapsed } : b))
    );
  }, []);

  // Helper to strip ANSI escape sequences from text
  const stripAnsi = useCallback((text: string): string => {
    // ANSI escape sequence pattern: \x1b\[([0-9;]*[mK])
    return text.replace(/\x1b\[[0-9;]*[mK]/g, "");
  }, []);

  // Search functionality
  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
    if (!query.trim()) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    // Compute search results across all blocks (search in plain text, not ANSI)
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    setBlocks((currentBlocks) => {
      currentBlocks.forEach((block, blockIndex) => {
        // Search in command (no ANSI sequences expected here)
        const commandPlain = block.command;
        const commandPlainLower = commandPlain.toLowerCase();
        let matchIndex = 0;
        let pos = 0;

        while ((pos = commandPlainLower.indexOf(lowerQuery, pos)) !== -1) {
          results.push({
            blockId: block.id,
            blockIndex,
            matchIndex: matchIndex++,
            start: pos,
            end: pos + query.length,
            text: commandPlain.slice(pos, pos + query.length),
          });
          pos += 1;
        }

        // Search in output (strip ANSI sequences first)
        const outputPlain = stripAnsi(block.output);
        const outputPlainLower = outputPlain.toLowerCase();
        pos = 0;

        while ((pos = outputPlainLower.indexOf(lowerQuery, pos)) !== -1) {
          results.push({
            blockId: block.id,
            blockIndex,
            matchIndex: matchIndex++,
            start: pos, // Position in plain text (without ANSI)
            end: pos + query.length,
            text: outputPlain.slice(pos, pos + query.length),
          });
          pos += 1;
        }
      });
      return currentBlocks;
    });

    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);
  }, []);

  const nextSearchResult = useCallback(() => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex((prev) => (prev + 1) % searchResults.length);
  }, [searchResults.length]);

  const prevSearchResult = useCallback(() => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
  }, [searchResults.length]);

  const clearSearch = useCallback(() => {
    setSearchQueryState("");
    setSearchResults([]);
    setCurrentSearchIndex(-1);
  }, []);

  const selectBlock = useCallback((index: number | null) => {
    setSelectedBlockIndex(index);
  }, []);

  const selectPrevBlock = useCallback(() => {
    setSelectedBlockIndex((prev) => {
      const currentBlocksLength = blocks.length;
      if (prev === null) return currentBlocksLength > 0 ? currentBlocksLength - 1 : null;
      return prev > 0 ? prev - 1 : 0;
    });
  }, [blocks.length]);

  const selectNextBlock = useCallback(() => {
    setSelectedBlockIndex((prev) => {
      const currentBlocksLength = blocks.length;
      if (prev === null) return null;
      if (prev >= currentBlocksLength - 1) return null;
      return prev + 1;
    });
  }, [blocks.length]);

  return {
    sessionId,
    blocks,
    isInputReady,
    phase: phaseRef.current,
    isAlternateScreen,
    isInteractiveCommandActive,
    interactiveSessionKind,
    aiAgentKind,
    isFullscreenTerminalActive,
    fullscreenOutputStart,
    fullscreenSession,
    rawOutputBaseOffset,
    rawOutput,
    getRawOutputSnapshot,
    subscribeToRawOutput,
    currentDirectory,
    gitBranch,
    sendInput,
    requestCompletion,
    resizePty,
    notifyFullscreenReady,
    clearBlocks,
    selectedBlockIndex,
    selectBlock,
    selectPrevBlock,
    selectNextBlock,
    // Collapse
    toggleBlockCollapse,
    // Search
    searchQuery,
    searchResults,
    currentSearchIndex,
    setSearchQuery,
    nextSearchResult,
    prevSearchResult,
    clearSearch,
    // Running block state
    runningBlock,
    hasRunningCommand,
    // Pane input mode
    paneInputMode,
    sendControlInput,
  };
}
