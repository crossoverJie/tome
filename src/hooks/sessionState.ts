import type { Block } from "./useTerminalSession";

interface SessionState {
  sessionId: string;
  blocks: Block[];
  isAlternateScreen: boolean;
  rawOutput: string;
  currentDirectory: string | null;
}

// Global session state registry to persist session data across component remounts
const sessionStateRegistry = new Map<string, SessionState>();
const paneToSessionMap = new Map<string, string>();

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

export function removeSessionState(sessionId: string): void {
  sessionStateRegistry.delete(sessionId);
}

export function clearAllSessionState(): void {
  sessionStateRegistry.clear();
  paneToSessionMap.clear();
}
