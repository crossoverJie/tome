// Interactive session kind - categorizes commands that need fullscreen terminal input handling
export type InteractiveSessionKind = "ai" | "repl" | "generic";

// Specific AI agent types (for behavior customization)
export type AiAgentKind = "claude" | "copilot" | null;
export type FullscreenMode = "interactive" | "alternate" | null;
export type FullscreenLifecycle = "inactive" | "activating" | "active" | "resizing";
export type FullscreenInteractionState = "inactive" | "active";

export interface FullscreenSessionState {
  mode: FullscreenMode;
  lifecycle: FullscreenLifecycle;
  sessionKind: InteractiveSessionKind | null;
  aiAgentKind: AiAgentKind;
  startOffset: number;
  pendingLaunch: boolean;
  hasPaneFocus: boolean;
}

export type FullscreenSessionEvent =
  | {
      type: "interactive-command-detected";
      sessionKind: InteractiveSessionKind;
      aiAgentKind: AiAgentKind;
      startOffset: number;
    }
  | {
      type: "interactive-command-started";
      sessionKind: InteractiveSessionKind;
      aiAgentKind: AiAgentKind;
      startOffset: number;
    }
  | { type: "fullscreen-session-ended"; endOffset: number }
  | { type: "alternate-screen-entered"; startOffset: number }
  | { type: "alternate-screen-exited"; endOffset: number }
  | { type: "pane-resized" }
  | { type: "resize-settled" }
  | { type: "pane-split" }
  | { type: "pane-focused" }
  | { type: "pane-blurred" };

export function createFullscreenSessionState(): FullscreenSessionState {
  return {
    mode: null,
    lifecycle: "inactive",
    sessionKind: null,
    aiAgentKind: null,
    startOffset: 0,
    pendingLaunch: false,
    hasPaneFocus: false,
  };
}

export function getFullscreenInteractionState(
  state: FullscreenSessionState
): FullscreenInteractionState {
  return state.lifecycle === "inactive" ? "inactive" : "active";
}

export function isFullscreenSessionActive(state: FullscreenSessionState): boolean {
  return getFullscreenInteractionState(state) === "active";
}

export function fullscreenSessionReducer(
  state: FullscreenSessionState,
  event: FullscreenSessionEvent
): FullscreenSessionState {
  switch (event.type) {
    case "interactive-command-detected":
      return {
        ...state,
        mode: "interactive",
        lifecycle: "activating",
        sessionKind: event.sessionKind,
        aiAgentKind: event.aiAgentKind,
        startOffset: event.startOffset,
        pendingLaunch: true,
      };
    case "interactive-command-started":
      return {
        ...state,
        mode: "interactive",
        lifecycle: "active",
        sessionKind: event.sessionKind,
        aiAgentKind: event.aiAgentKind,
        startOffset: event.startOffset,
        pendingLaunch: false,
      };
    case "fullscreen-session-ended":
      return {
        ...createFullscreenSessionState(),
        startOffset: event.endOffset,
        hasPaneFocus: state.hasPaneFocus,
      };
    case "alternate-screen-entered":
      return {
        ...state,
        mode: "alternate",
        lifecycle: "active",
        sessionKind: state.sessionKind,
        aiAgentKind: state.aiAgentKind,
        startOffset: event.startOffset,
        pendingLaunch: false,
      };
    case "alternate-screen-exited":
      return {
        ...createFullscreenSessionState(),
        startOffset: event.endOffset,
        hasPaneFocus: state.hasPaneFocus,
      };
    case "pane-resized":
    case "pane-split":
      if (state.lifecycle === "inactive") {
        return state;
      }
      return {
        ...state,
        lifecycle: "resizing",
      };
    case "resize-settled":
      if (state.lifecycle !== "resizing") {
        return state;
      }
      return {
        ...state,
        lifecycle: "active",
      };
    case "pane-focused":
      return {
        ...state,
        hasPaneFocus: true,
        lifecycle: state.lifecycle === "resizing" ? "active" : state.lifecycle,
      };
    case "pane-blurred":
      return {
        ...state,
        hasPaneFocus: false,
      };
    default:
      return state;
  }
}
