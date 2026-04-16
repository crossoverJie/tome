import type { Block } from "./useTerminalSession";
import type {
  FullscreenSessionState,
  InteractiveSessionKind,
  AiAgentKind,
} from "../utils/fullscreenSessionState";
import type { PaneAgentState } from "../utils/agentStatus";

interface SessionState {
  sessionId: string;
  blocks: Block[];
  isAlternateScreen: boolean;
  isInteractiveCommandActive: boolean;
  interactiveSessionKind: InteractiveSessionKind | null;
  aiAgentKind: AiAgentKind;
  fullscreenOutputStart: number;
  fullscreenSession: FullscreenSessionState;
  rawOutputBaseOffset: number;
  rawOutput: string;
  currentDirectory: string | null;
  gitBranch: string | null;
}

export type { SessionState };

export interface PaneSessionInitOptions {
  initialCwd?: string;
}

// Global session state registry to persist session data across component remounts
const sessionStateRegistry = new Map<string, SessionState>();
const paneToSessionMap = new Map<string, string>();
const paneSessionInitOptionsRegistry = new Map<string, PaneSessionInitOptions>();

// Pane-level agent state registry - tracks active AI agents per pane
const paneAgentStateRegistry = new Map<string, PaneAgentState>();

export function getSessionState(sessionId: string): SessionState | undefined {
  return sessionStateRegistry.get(sessionId);
}

export function setSessionState(sessionId: string, state: SessionState): void {
  sessionStateRegistry.set(sessionId, state);
}

export function updateSessionState(sessionId: string, updates: Partial<SessionState>): void {
  const existing = sessionStateRegistry.get(sessionId);
  if (existing) {
    sessionStateRegistry.set(sessionId, { ...existing, ...updates });
  }
}

export function getSessionIdForPane(paneId: string): string | undefined {
  return paneToSessionMap.get(paneId);
}

export function setSessionIdForPane(paneId: string, sessionId: string): void {
  paneToSessionMap.set(paneId, sessionId);
}

export function removePaneMapping(paneId: string): void {
  paneToSessionMap.delete(paneId);
  // Also clean up agent state when pane is removed
  paneAgentStateRegistry.delete(paneId);
}

export function setPaneSessionInitOptions(paneId: string, options: PaneSessionInitOptions): void {
  paneSessionInitOptionsRegistry.set(paneId, options);
}

export function getPaneSessionInitOptions(paneId: string): PaneSessionInitOptions | undefined {
  return paneSessionInitOptionsRegistry.get(paneId);
}

export function consumePaneSessionInitOptions(paneId: string): PaneSessionInitOptions | undefined {
  const options = paneSessionInitOptionsRegistry.get(paneId);
  paneSessionInitOptionsRegistry.delete(paneId);
  return options;
}

export function removePaneSessionInitOptions(paneId: string): void {
  paneSessionInitOptionsRegistry.delete(paneId);
}

export function removeSessionState(sessionId: string): void {
  sessionStateRegistry.delete(sessionId);
}

// Raw output tracking for menu bar agent overview
const paneRawOutputRegistry = new Map<string, string>();
const paneLastActivityRegistry = new Map<string, number>();

export function setPaneRawOutput(paneId: string, output: string): void {
  paneRawOutputRegistry.set(paneId, output);
}

export function getPaneRawOutput(paneId: string): string | undefined {
  return paneRawOutputRegistry.get(paneId);
}

export function updatePaneActivity(paneId: string): void {
  paneLastActivityRegistry.set(paneId, Date.now());
}

export function getPaneLastActivity(paneId: string): number | undefined {
  return paneLastActivityRegistry.get(paneId);
}

export function removePaneOutputAndActivity(paneId: string): void {
  paneRawOutputRegistry.delete(paneId);
  paneLastActivityRegistry.delete(paneId);
}

// Pane agent state management
export function getPaneAgentState(paneId: string): PaneAgentState | undefined {
  return paneAgentStateRegistry.get(paneId);
}

export function setPaneAgentState(paneId: string, state: PaneAgentState): void {
  paneAgentStateRegistry.set(paneId, state);
}

export function updatePaneAgentState(paneId: string, updates: Partial<PaneAgentState>): void {
  const existing = paneAgentStateRegistry.get(paneId);
  if (existing) {
    paneAgentStateRegistry.set(paneId, { ...existing, ...updates });
  } else {
    // Create new state with defaults if not exists
    paneAgentStateRegistry.set(paneId, {
      aiAgentKind: null,
      isActive: false,
      ...updates,
    });
  }
}

export function removePaneAgentState(paneId: string): void {
  paneAgentStateRegistry.delete(paneId);
}

export function clearAllSessionState(): void {
  sessionStateRegistry.clear();
  paneToSessionMap.clear();
  paneSessionInitOptionsRegistry.clear();
  paneAgentStateRegistry.clear();
}
