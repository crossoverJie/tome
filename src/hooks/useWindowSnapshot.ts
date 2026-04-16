import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "../types/tab";
import type { PaneAgentState } from "../utils/agentStatus";
import {
  buildWindowSnapshot,
  ThrottledSnapshotEmitter,
  type WindowSnapshot,
} from "../utils/windowSnapshot";
import { getPaneLastActivity } from "../hooks/sessionState";

interface UseWindowSnapshotProps {
  tabs: Tab[];
  activeTabId: string | null;
  paneAgentMap: Map<string, PaneAgentState>;
  paneDirectoryMap: Map<string, string | null>;
}

/**
 * Hook to manage window snapshot reporting to Rust backend
 */
export function useWindowSnapshot({
  tabs,
  activeTabId,
  paneAgentMap,
  paneDirectoryMap,
}: UseWindowSnapshotProps) {
  const windowLabelRef = useRef<string>("");
  const isFocusedRef = useRef<boolean>(false);
  const emitterRef = useRef<ThrottledSnapshotEmitter | null>(null);

  // Initialize window label
  useEffect(() => {
    const init = async () => {
      const window = await getCurrentWindow();
      windowLabelRef.current = window.label;

      // Listen for focus changes
      window.onFocusChanged(({ payload: focused }) => {
        isFocusedRef.current = focused;
        scheduleSnapshot();
      });

      // Initial focus state
      isFocusedRef.current = await window.isFocused();
    };
    void init();
  }, []);

  // Create emitter
  useEffect(() => {
    const emitFn = async (snapshot: WindowSnapshot) => {
      try {
        await invoke("update_window_snapshot", { snapshot });
      } catch (error) {
        console.error("[windowSnapshot] Failed to emit snapshot:", error);
      }
    };

    emitterRef.current = new ThrottledSnapshotEmitter(emitFn, 500);

    return () => {
      emitterRef.current?.destroy();
      emitterRef.current = null;
    };
  }, []);

  // Helper to get last activity for a pane
  const getLastActivityForPane = useCallback((paneId: string): number => {
    return getPaneLastActivity(paneId) ?? Date.now();
  }, []);

  // Schedule snapshot emission
  const scheduleSnapshot = useCallback(() => {
    if (!windowLabelRef.current || !emitterRef.current) return;

    const windowTitle = document.title || "Tome";
    const snapshot = buildWindowSnapshot(
      windowLabelRef.current,
      windowTitle,
      isFocusedRef.current,
      tabs,
      activeTabId,
      paneAgentMap,
      paneDirectoryMap,
      getLastActivityForPane
    );

    emitterRef.current.schedule(snapshot);
  }, [tabs, activeTabId, paneAgentMap, paneDirectoryMap, getLastActivityForPane]);

  // Schedule snapshot when relevant state changes
  useEffect(() => {
    scheduleSnapshot();
  }, [tabs, activeTabId, paneAgentMap, paneDirectoryMap, scheduleSnapshot]);

  // Handle window events that should trigger snapshot
  useEffect(() => {
    const handleVisibilityChange = () => scheduleSnapshot();
    const handleFocus = () => {
      isFocusedRef.current = true;
      scheduleSnapshot();
    };
    const handleBlur = () => {
      isFocusedRef.current = false;
      scheduleSnapshot();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [scheduleSnapshot]);

  return { scheduleSnapshot };
}
