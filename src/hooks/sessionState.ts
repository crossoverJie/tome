import type { Block } from "./useTerminalSession";
import type { FullscreenSessionState } from "../utils/fullscreenSessionState";

interface SessionState {
  sessionId: string;
  blocks: Block[];
  isAlternateScreen: boolean;
  isInteractiveCommandActive: boolean;
  interactiveCommandKind: "claude" | "copilot" | null;
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

export function clearAllSessionState(): void {
  sessionStateRegistry.clear();
  paneToSessionMap.clear();
  paneSessionInitOptionsRegistry.clear();
}
