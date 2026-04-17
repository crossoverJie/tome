import type { Tab } from "../types/tab";
import type { PaneNode } from "../types/pane";
import type { AiAgentKind, ConversationRound } from "./fullscreenSessionState";
import type { PaneAgentState } from "./agentStatus";
import { getPaneAgentState } from "../hooks/sessionState";

/**
 * Truncate text to max length, adding ellipsis if truncated
 */
function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text || "";
  }
  // Keep first part and last part with ellipsis in middle
  const keepLength = Math.floor(maxLength / 2) - 2;
  return text.slice(0, keepLength) + "..." + text.slice(-keepLength);
}

/**
 * Agent status enum for menu bar overview
 * Unified status for cross-window agent display
 */
export type AgentStatus = "running" | "waiting_input" | "idle" | "error" | "unknown";

/**
 * Conversation round preview for display (subset of ConversationRound)
 */
export interface ConversationRoundPreview {
  user_input: string;
  agent_response: string;
}

/**
 * Pane snapshot for window snapshot
 */
export interface PaneSnapshot {
  pane_id: string;
  cwd: string | null;
  agent_kind: AiAgentKind;
  agent_status: AgentStatus;
  is_focused: boolean;
  last_activity_at: number;
  // Conversation tracking for Agent Overview
  total_rounds: number;
  recent_conversations: ConversationRoundPreview[];
  session_id: string | null;
}

/**
 * Tab snapshot for window snapshot
 */
export interface TabSnapshot {
  tab_id: string;
  tab_label: string;
  root_pane_id: string;
  focused_pane_id: string | null;
  panes: PaneSnapshot[];
}

/**
 * Window snapshot - complete state of a single window
 */
export interface WindowSnapshot {
  window_label: string;
  window_title: string;
  is_focused: boolean;
  updated_at: number;
  tabs: TabSnapshot[];
}

/**
 * Global agent overview data from Rust backend
 */
export interface AgentOverviewData {
  total_agents: number;
  running_count: number;
  waiting_input_count: number;
  idle_count: number;
  error_count: number;
  unknown_count: number;
  last_activity_at: number | null;
  windows: WindowSnapshot[];
  stats: {
    total_agents: number;
    running_count: number;
    waiting_input_count: number;
    idle_count: number;
    error_count: number;
    unknown_count: number;
    last_activity_at: number | null;
  };
}

/**
 * Agent statistics from Rust backend
 */
export interface AgentStats {
  total_agents: number;
  running_count: number;
  waiting_input_count: number;
  idle_count: number;
  error_count: number;
  unknown_count: number;
  last_activity_at: number | null;
}

// Constants for preview text
const PREVIEW_MAX_LINES = 4;
const PREVIEW_MAX_CHARS = 180;
const ACTIVITY_IDLE_THRESHOLD_MS = 30000; // 30 seconds
const ACTIVITY_ERROR_THRESHOLD_MS = 300000; // 5 minutes (possible crash)

/**
 * Clean ANSI escape sequences from text
 * Handles color codes, cursor movement, and other control sequences
 */
export function cleanAnsiSequences(text: string): string {
  // Step 1: Remove CSI sequences (ESC [ ...)
  // CSI sequences can contain parameters (digits, semicolons, ? < > = etc.) and end with a letter
  // eslint-disable-next-line no-control-regex
  let cleaned = text.replace(/\x1b\[[0-9;:?<>=]*[A-Za-z]/g, "");

  // Step 2: Remove other escape sequences
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/\x1b[@-Z\-_\x7f]/g, "");

  // Step 3: Remove OSC sequences (ESC ] ... BEL)
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/\x1b\][^\x07]*\x07?/g, "");

  // Step 4: Remove remaining escape sequences (ESC + any chars)
  // This catches any remaining sequences like ESC ( 0, ESC ) B, etc.
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/\x1b[\x20-\x7e]*/g, "");

  return cleaned;
}

/**
 * Clean control characters from text
 */
export function cleanControlCharacters(text: string): string {
  // Remove control characters except newlines (\x0a) and tabs (\x09)
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b-\x0c\x0d\x0e-\x1f\x7f]/g, "");
}

/**
 * Strip prompt characters from user input
 * Removes common prompt symbols like ❯, $, #, >, etc.
 */
export function stripPromptCharacters(text: string): string {
  // Remove common prompt characters at the start of the line
  return text.replace(/^[❯$#>➜\s]+/, "").trim();
}

/**
 * Clean user input from terminal
 * Extracts just the command/input, removing decorations
 */
export function cleanUserInput(text: string): string {
  // Take only the first line
  const firstLine = text.split("\n")[0];
  // Remove prompt characters
  let cleaned = stripPromptCharacters(firstLine);
  // Remove decorative patterns like ( .--. ), (_/ \_), etc.
  cleaned = cleaned.replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*$/g, "");
  return cleaned.trim();
}

/**
 * Clean agent response
 * Removes thinking process markers and decorations
 */
export function cleanAgentResponse(text: string, userInput?: string): string {
  // First clean ANSI sequences and control characters
  let cleaned = cleanAnsiSequences(text);
  cleaned = cleanControlCharacters(cleaned);

  // Split into lines
  const lines = cleaned.split("\n");
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Skip user input echo if provided - check if line starts with or contains user input
    if (userInput) {
      const cleanedUserInput = userInput.replace(/[❯$#>➜\s]/g, "").trim();
      const cleanedLine = trimmed.replace(/[❯$#>➜\s]/g, "").trim();
      // Skip if the entire line is just the user input
      if (cleanedLine === cleanedUserInput) continue;
      // Skip if line starts with user input followed by decorative content
      if (cleanedLine.startsWith(cleanedUserInput)) {
        const afterInput = cleanedLine.slice(cleanedUserInput.length).trim();
        // If what remains is mostly decorative, skip the whole line
        if (/^[✢✻✶✳✽⎿·~}\{\(\)_\-…]+$/.test(afterInput)) continue;
      }
    }

    // Skip lines that are just thinking markers, status indicators and decorative symbols
    // Added ✽ ( composing indicator) and ◐
    if (/^[✢✻✶✳✽⎿·~}\{\(\)_\-…◐\/\\]+$/.test(trimmed)) continue;

    // Skip lines that are just horizontal dividers (box drawing chars ─ ━ ═ etc.)
    if (/^[─━═\-\s]+$/.test(trimmed)) continue;

    // Skip status/progress lines
    if (trimmed.includes("Composing")) continue;
    if (trimmed.includes("thinking with")) continue;
    if (trimmed.includes("Lollygagging")) continue;
    if (trimmed.includes("Orchestrating")) continue;
    if (trimmed.includes("Misting")) continue;
    if (trimmed.startsWith("Tip:")) continue;
    if (trimmed.includes("Double-tap esc")) continue;

    // Skip footer/status bar lines - contains "esc", "interrupt", "medium", "effort" etc.
    // These are the status bar at the bottom of Claude's UI
    if (/esctointerrupt|medium.?effort|high.?effort|low.?effort/i.test(trimmed)) continue;

    // Remove inline decorative sequences from lines that have content
    let contentLine = line
      .replace(/[✢✻✶✳✽⎿·~}\{\(\)_\-…◐]/g, "") // Remove individual decorative chars including ✽ and ◐
      .replace(/[─━═]{3,}/g, "") // Remove horizontal divider sequences (3 or more)
      .replace(/\s+/g, " ") // Collapse multiple spaces
      .trim();

    // Skip if after removing decorations, line is empty or just thinking markers
    if (!contentLine) continue;
    if (contentLine.includes("thinking with")) continue;
    if (contentLine.includes("Lollygagging")) continue;
    if (contentLine.includes("Orchestrating")) continue;
    if (contentLine.includes("Misting")) continue;
    if (contentLine.includes("Composing")) continue;
    if (contentLine.startsWith("Tip:")) continue;
    if (contentLine.includes("Double-tap esc")) continue;
    if (/^[a-zA-Z]$/.test(contentLine)) continue; // Single letters

    cleanedLines.push(contentLine);
  }

  // Collapse whitespace and return
  return collapseWhitespace(cleanedLines.join("\n").trim());
}

/**
 * Collapse excessive whitespace
 */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ") // Collapse spaces/tabs
    .replace(/\n{3,}/g, "\n\n"); // Max 2 consecutive newlines
}

/**
 * Extract preview text from raw terminal output
 */
export function extractPreviewText(rawOutput: string): string {
  if (!rawOutput) {
    return "";
  }

  // Clean the output
  let cleaned = cleanAnsiSequences(rawOutput);
  cleaned = cleanControlCharacters(cleaned);
  cleaned = collapseWhitespace(cleaned);

  // Split into lines and take last N lines
  const lines = cleaned.split("\n").filter((line) => line.trim().length > 0);
  const previewLines = lines.slice(-PREVIEW_MAX_LINES);

  // Join and truncate
  let preview = previewLines.join("\n").trim();
  if (preview.length > PREVIEW_MAX_CHARS) {
    preview = preview.slice(0, PREVIEW_MAX_CHARS) + "…";
  }

  return preview;
}

/**
 * Determine agent status based on fullscreen state and activity
 */
export function determineAgentStatus(
  aiAgentKind: AiAgentKind,
  isFullscreenActive: boolean,
  lastActivityAt: number,
  isWaitingInput: boolean
): AgentStatus {
  if (aiAgentKind === null) {
    return "idle";
  }

  if (!isFullscreenActive) {
    // Fullscreen session ended
    return "idle";
  }

  if (isWaitingInput) {
    return "waiting_input";
  }

  // Check if recently active
  const timeSinceActivity = Date.now() - lastActivityAt;

  // If inactive for very long, mark as possible error (agent may have crashed)
  if (timeSinceActivity > ACTIVITY_ERROR_THRESHOLD_MS) {
    return "error";
  }

  if (timeSinceActivity > ACTIVITY_IDLE_THRESHOLD_MS) {
    return "idle";
  }

  return "running";
}

/**
 * Build pane snapshot from pane state
 */
export function buildPaneSnapshot(
  paneId: string,
  paneNode: PaneNode,
  paneAgentState: PaneAgentState | undefined,
  isFocused: boolean,
  currentDirectory: string | null,
  conversationHistory: ConversationRound[],
  totalRounds: number,
  lastActivityAt: number
): PaneSnapshot {
  const agentKind = paneAgentState?.aiAgentKind ?? null;
  const isFullscreenActive = paneAgentState?.isActive ?? false;

  // Determine status (V1: simplified, not detecting waiting_input yet)
  const agentStatus = determineAgentStatus(
    agentKind,
    isFullscreenActive,
    lastActivityAt,
    false // V1: waiting_input detection to be implemented later
  );

  // Get recent conversations for display (last 3 rounds)
  const recentConversations: ConversationRoundPreview[] = conversationHistory
    .slice(-3)
    .map((round) => ({
      user_input: truncateText(round.user_input, 100),
      agent_response: truncateText(round.agent_response, 200),
    }));

  return {
    pane_id: paneId,
    cwd: currentDirectory,
    agent_kind: agentKind,
    agent_status: agentStatus,
    is_focused: isFocused,
    last_activity_at: lastActivityAt,
    total_rounds: totalRounds,
    recent_conversations: recentConversations,
    session_id: paneNode.sessionId ?? null,
  };
}

/**
 * Build tab snapshot from tab state
 */
export function buildTabSnapshot(
  tab: Tab,
  paneAgentMap: Map<string, PaneAgentState>,
  paneDirectoryMap: Map<string, string | null>,
  getLastActivityForPane: (paneId: string) => number
): TabSnapshot {
  const paneSnapshots: PaneSnapshot[] = [];

  // Collect all leaf panes
  const collectLeafPanes = (paneId: string) => {
    const pane = tab.panes.get(paneId);
    if (!pane) return;

    if (pane.type === "leaf") {
      const agentState = paneAgentMap.get(paneId);
      const cwd = paneDirectoryMap.get(paneId) ?? null;
      const isFocused = tab.focusedPaneId === paneId;
      const lastActivity = getLastActivityForPane(paneId);
      // Get conversation data directly from registry (may be updated after agentState was set)
      const paneStateFromRegistry = getPaneAgentState(paneId);
      const conversationHistory =
        paneStateFromRegistry?.conversationHistory ?? agentState?.conversationHistory ?? [];
      const totalRounds = paneStateFromRegistry?.totalRounds ?? agentState?.totalRounds ?? 0;

      paneSnapshots.push(
        buildPaneSnapshot(
          paneId,
          pane,
          agentState,
          isFocused,
          cwd,
          conversationHistory,
          totalRounds,
          lastActivity
        )
      );
    } else if (pane.children) {
      for (const childId of pane.children) {
        collectLeafPanes(childId);
      }
    }
  };

  collectLeafPanes(tab.rootPaneId);

  return {
    tab_id: tab.id,
    tab_label: tab.title,
    root_pane_id: tab.rootPaneId,
    focused_pane_id: tab.focusedPaneId,
    panes: paneSnapshots,
  };
}

/**
 * Build window snapshot from app state
 */
export function buildWindowSnapshot(
  windowLabel: string,
  windowTitle: string,
  isFocused: boolean,
  tabs: Tab[],
  _activeTabId: string | null,
  paneAgentMap: Map<string, PaneAgentState>,
  paneDirectoryMap: Map<string, string | null>,
  getLastActivityForPane: (paneId: string) => number
): WindowSnapshot {
  const tabSnapshots = tabs.map((tab) =>
    buildTabSnapshot(tab, paneAgentMap, paneDirectoryMap, getLastActivityForPane)
  );

  return {
    window_label: windowLabel,
    window_title: windowTitle,
    is_focused: isFocused,
    updated_at: Date.now(),
    tabs: tabSnapshots,
  };
}

/**
 * Throttled snapshot emitter
 * Merges rapid updates to avoid excessive IPC
 */
export class ThrottledSnapshotEmitter {
  private pendingSnapshot: WindowSnapshot | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly delayMs: number;
  private emitFn: (snapshot: WindowSnapshot) => void;

  constructor(emitFn: (snapshot: WindowSnapshot) => void, delayMs = 500) {
    this.emitFn = emitFn;
    this.delayMs = delayMs;
  }

  /**
   * Schedule a snapshot to be emitted
   */
  schedule(snapshot: WindowSnapshot): void {
    this.pendingSnapshot = snapshot;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      this.flush();
    }, this.delayMs);
  }

  /**
   * Immediately emit pending snapshot if any
   */
  flush(): void {
    if (this.pendingSnapshot) {
      this.emitFn(this.pendingSnapshot);
      this.pendingSnapshot = null;
    }

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Destroy the emitter
   */
  destroy(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.pendingSnapshot = null;
  }
}
