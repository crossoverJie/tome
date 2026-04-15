import type { AiAgentKind } from "./fullscreenSessionState";
import type { Tab } from "../types/tab";
import { getLeafPaneIds } from "../types/pane";

/**
 * Agent token mapping - two-letter short codes for compact display
 */
export const AGENT_TOKENS: Record<Exclude<AiAgentKind, null>, string> = {
  claude: "cc",
  codex: "cx",
  opencode: "op",
  copilot: "cp",
};

/**
 * Agent full labels for tooltip display
 */
export const AGENT_LABELS: Record<Exclude<AiAgentKind, null>, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  copilot: "Copilot",
};

/**
 * Stable sort order for agent tokens: Cl, Cx, Op, Cp
 */
const AGENT_ORDER: Exclude<AiAgentKind, null>[] = ["claude", "codex", "opencode", "copilot"];

/**
 * Pane-level agent state
 */
export interface PaneAgentState {
  aiAgentKind: AiAgentKind;
  isActive: boolean;
}

/**
 * Aggregated agent summary for a tab
 */
export interface TabAgentSummary {
  /** Unique agent kinds active in this tab (deduplicated) */
  agents: Exclude<AiAgentKind, null>[];
  /** Number of leaf panes with active agents */
  activePaneCount: number;
  /** Total number of active agent instances */
  totalAgentCount: number;
}

/**
 * Structured presentation for tab display
 */
export interface TabPresentation {
  /** Short label for tab bar display */
  label: string;
  /** Full tooltip text */
  tooltip: string;
}

/**
 * Get token for an agent kind
 */
export function getAgentToken(kind: Exclude<AiAgentKind, null>): string {
  return AGENT_TOKENS[kind];
}

/**
 * Get full label for an agent kind
 */
export function getAgentLabel(kind: Exclude<AiAgentKind, null>): string {
  return AGENT_LABELS[kind];
}

/**
 * Sort agents by stable order (Cl, Cx, Op, Cp)
 */
export function sortAgents(agents: Exclude<AiAgentKind, null>[]): Exclude<AiAgentKind, null>[] {
  return [...agents].sort((a, b) => AGENT_ORDER.indexOf(a) - AGENT_ORDER.indexOf(b));
}

/**
 * Format agents into compact tab label
 * - No agents: "tome"
 * - 1 agent: "tome · Cl"
 * - 2 agents: "tome · Cl+Cx"
 * - >2 agents: "tome · Cl+Cx+2" (first two + count of remaining)
 */
export function formatAgentLabel(
  directoryName: string,
  agents: Exclude<AiAgentKind, null>[]
): string {
  if (agents.length === 0) {
    return directoryName;
  }

  const sorted = sortAgents(agents);
  const tokens = sorted.map(getAgentToken);

  if (tokens.length <= 2) {
    return `${directoryName} · ${tokens.join("+")}`;
  }

  // Show first two tokens + count of remaining
  const remaining = tokens.length - 2;
  return `${directoryName} · ${tokens[0]}+${tokens[1]}+${remaining}`;
}

/**
 * Build tooltip content for a tab
 */
export function buildAgentTooltip(directoryPath: string | null, summary: TabAgentSummary): string {
  const pathDisplay = directoryPath ?? "Shell";

  if (summary.agents.length === 0) {
    return pathDisplay;
  }

  const sorted = sortAgents(summary.agents);
  const agentList = sorted.map(getAgentLabel).join(", ");

  if (summary.activePaneCount === 1) {
    return `${pathDisplay}\nRunning: ${agentList}`;
  }

  return `${pathDisplay}\nRunning in ${summary.activePaneCount} panes: ${agentList}`;
}

/**
 * Aggregate agent summary from pane agent states
 */
export function aggregateTabAgentSummary(
  tab: Tab,
  paneAgentMap: Map<string, PaneAgentState>
): TabAgentSummary {
  const leafPaneIds = getLeafPaneIds(tab.panes, tab.rootPaneId);
  const agents = new Set<Exclude<AiAgentKind, null>>();
  let activePaneCount = 0;
  let totalAgentCount = 0;

  for (const paneId of leafPaneIds) {
    const state = paneAgentMap.get(paneId);
    if (state?.isActive && state.aiAgentKind !== null) {
      agents.add(state.aiAgentKind);
      activePaneCount++;
      totalAgentCount++;
    }
  }

  return {
    agents: sortAgents(Array.from(agents)),
    activePaneCount,
    totalAgentCount,
  };
}

/**
 * Create tab presentation (label + tooltip) from directory and agent summary
 */
export function createTabPresentation(
  directoryName: string,
  directoryPath: string | null,
  summary: TabAgentSummary
): TabPresentation {
  return {
    label: formatAgentLabel(directoryName, summary.agents),
    tooltip: buildAgentTooltip(directoryPath, summary),
  };
}
