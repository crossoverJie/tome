import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  getSessionState,
  setSessionState,
  updateSessionState,
  getSessionIdForPane,
  setSessionIdForPane,
} from "./sessionState";

export interface Block {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: number;
  endTime: number | null;
  isComplete: boolean;
}

type Phase = "prompt" | "input" | "running" | "idle";

type TerminalEvent =
  | { kind: "output"; session_id: string; data: string }
  | { kind: "block"; session_id: string; event_type: string; exit_code: number | null }
  | { kind: "alternate_screen"; session_id: string; active: boolean };

interface UseTerminalSessionReturn {
  sessionId: string | null;
  blocks: Block[];
  isAlternateScreen: boolean;
  rawOutput: string;
  sendInput: (data: string) => void;
  resizePty: (cols: number, rows: number) => void;
  clearBlocks: () => void;
  selectedBlockIndex: number | null;
  selectBlock: (index: number | null) => void;
  selectPrevBlock: () => void;
  selectNextBlock: () => void;
}

export function useTerminalSession(paneId?: string, existingSessionId?: string): UseTerminalSessionReturn {
  // Get persisted session ID for this pane
  const persistedSessionId = paneId ? getSessionIdForPane(paneId) : undefined;
  const initialSessionId = existingSessionId || persistedSessionId || null;

  const [sessionId, setSessionIdState] = useState<string | null>(initialSessionId);

  // Use a ref to track if we've initialized to avoid race conditions
  const hasInitialized = useRef(false);

  // Get persisted state if available
  const persistedState = initialSessionId ? getSessionState(initialSessionId) : undefined;

  const [blocks, setBlocks] = useState<Block[]>(persistedState?.blocks || []);
  const [isAlternateScreen, setIsAlternateScreen] = useState(persistedState?.isAlternateScreen || false);
  const [rawOutput, setRawOutput] = useState(persistedState?.rawOutput || "");
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const currentCommandRef = useRef("");
  const pendingCommandRef = useRef("");
  const blockIdCounter = useRef(persistedState?.blocks?.length || 0);

  // Persist state whenever it changes
  useEffect(() => {
    if (sessionId) {
      updateSessionState(sessionId, { blocks, isAlternateScreen, rawOutput });
    }
  }, [sessionId, blocks, isAlternateScreen, rawOutput]);

  useEffect(() => {
    // Prevent double initialization
    if (hasInitialized.current) {
      return;
    }

    let unlisten: UnlistenFn | undefined;

    async function init() {
      // Determine the session ID to use
      let sid: string;

      if (sessionId) {
        // Use existing session ID
        sid = sessionId;
      } else {
        // Create new session
        sid = await invoke<string>("create_session");
        setSessionIdState(sid);

        // Register session ID for this pane
        if (paneId) {
          setSessionIdForPane(paneId, sid);
        }

        // Initialize session state
        setSessionState(sid, {
          sessionId: sid,
          blocks: [],
          isAlternateScreen: false,
          rawOutput: "",
        });
      }

      hasInitialized.current = true;

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
        }
      });
    }

    init();
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

  const resizePty = useCallback(
    (cols: number, rows: number) => {
      if (!sessionId) return;
      invoke("resize_pty", { sessionId, cols, rows });
    },
    [sessionId]
  );

  const clearBlocks = useCallback(() => {
    setBlocks([]);
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
    sendInput,
    resizePty,
    clearBlocks,
    selectedBlockIndex,
    selectBlock,
    selectPrevBlock,
    selectNextBlock,
  };
}
