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
} from "./sessionState";
import type { CompletionResponse } from "../types/completion";

export interface Block {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: number;
  endTime: number | null;
  isComplete: boolean;
  isCollapsed: boolean;
}

type Phase = "prompt" | "input" | "running" | "idle";

export interface SearchResult {
  blockId: string;
  blockIndex: number;
  matchIndex: number;
  start: number;
  end: number;
  text: string;
}

type TerminalEvent =
  | { kind: "output"; session_id: string; data: string }
  | { kind: "block"; session_id: string; event_type: string; exit_code: number | null }
  | { kind: "alternate_screen"; session_id: string; active: boolean }
  | { kind: "current_directory"; session_id: string; path: string };

interface UseTerminalSessionReturn {
  sessionId: string | null;
  blocks: Block[];
  isAlternateScreen: boolean;
  rawOutput: string;
  currentDirectory: string | null;
  sendInput: (data: string) => void;
  requestCompletion: (text: string, cursor: number) => Promise<CompletionResponse>;
  resizePty: (cols: number, rows: number) => void;
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
}

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
  const [isAlternateScreen, setIsAlternateScreen] = useState(
    persistedState?.isAlternateScreen || false
  );
  const [rawOutput, setRawOutput] = useState(persistedState?.rawOutput || "");
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(
    persistedState?.currentDirectory || null
  );
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const currentCommandRef = useRef("");
  const pendingCommandRef = useRef("");
  const blockIdCounter = useRef(persistedState?.blocks?.length || 0);

  // Search state
  const [searchQuery, setSearchQueryState] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);

  // Persist state whenever it changes
  useEffect(() => {
    if (sessionId) {
      updateSessionState(sessionId, { blocks, isAlternateScreen, rawOutput, currentDirectory });
    }
  }, [sessionId, blocks, isAlternateScreen, rawOutput, currentDirectory]);

  useEffect(() => {
    // Prevent double initialization
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    let unlisten: UnlistenFn | undefined;

    async function init() {
      try {
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
            rawOutput: "",
            currentDirectory: null,
          });
        }

        const cwd = await invoke<string>("get_current_directory", { sessionId: sid });
        setCurrentDirectory(cwd);

        // Set up event listener for this session
        unlisten = await listen<TerminalEvent>("terminal-event", (event) => {
          const payload = event.payload;
          if (payload.session_id !== sid) return;

          switch (payload.kind) {
            case "output": {
              const data = payload.data;
              setRawOutput((prev) => prev + data);

              // Only append output to block when a command is running
              if (phaseRef.current !== "running") return;

              setBlocks((prev) => {
                const last = prev[prev.length - 1];
                if (last && !last.isComplete) {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...last,
                    output: last.output + data,
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
                  break;
                case "input_start":
                  phaseRef.current = "input";
                  currentCommandRef.current = "";
                  break;
                case "command_start": {
                  phaseRef.current = "running";
                  const cmd = pendingCommandRef.current || currentCommandRef.current;
                  pendingCommandRef.current = "";
                  const id = `block-${++blockIdCounter.current}`;
                  setBlocks((prev) => [
                    ...prev,
                    {
                      id,
                      command: cmd,
                      output: "",
                      exitCode: null,
                      startTime: Date.now(),
                      endTime: null,
                      isComplete: false,
                      isCollapsed: false,
                    },
                  ]);
                  break;
                }
                case "command_end":
                  phaseRef.current = "idle";
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
                  break;
              }
              break;
            }

            case "alternate_screen":
              setIsAlternateScreen(payload.active);
              break;
            case "current_directory":
              setCurrentDirectory(payload.path);
              break;
          }
        });
      } catch (error) {
        hasInitialized.current = false;
        console.error("Failed to initialize terminal session", error);
      }
    }

    void init();
    return () => {
      unlisten?.();
    };
  }, [paneId]);

  const sendInput = useCallback(
    (data: string) => {
      if (!sessionId) return;
      // Capture full command before sending to PTY (race-free)
      if (data.endsWith("\n")) {
        const cmd = data.slice(0, -1).trim();
        if (cmd) {
          pendingCommandRef.current = cmd;
        }
      }
      if (phaseRef.current === "input") {
        currentCommandRef.current += data;
      }
      invoke("write_input", { sessionId, data });
    },
    [sessionId]
  );

  const requestCompletion = useCallback(
    async (text: string, cursor: number) => {
      if (!sessionId) {
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
    [sessionId]
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
    isAlternateScreen,
    rawOutput,
    currentDirectory,
    sendInput,
    requestCompletion,
    resizePty,
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
  };
}
