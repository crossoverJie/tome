import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AGENT_LABELS, AGENT_TOKENS } from "../utils/agentStatus";
import type {
  AgentOverviewData,
  WindowSnapshot,
  TabSnapshot,
  PaneSnapshot,
  AgentStatus,
} from "../utils/windowSnapshot";
import "./Overview.css";

const POLL_INTERVAL_MS = 2000;

console.log("[Overview] Component module loaded");

export function Overview() {
  console.log("[Overview] Component rendering");

  // Catch any synchronous errors during render
  try {
    return <OverviewContent />;
  } catch (error) {
    console.error("[Overview] Render error:", error);
    return (
      <div className="overview-error">
        <span className="overview-error-icon">💥</span>
        <span>Render error: {String(error)}</span>
        <pre style={{fontSize: '10px', marginTop: '10px'}}>{error instanceof Error ? error.stack : ''}</pre>
      </div>
    );
  }
}

function OverviewContent() {
  console.log("[Overview] OverviewContent rendering");
  const [overviewData, setOverviewData] = useState<AgentOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      const data = await invoke<AgentOverviewData>("get_agent_overview");
      setOverviewData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch overview");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    void fetchOverview();

    // Poll for updates
    const interval = setInterval(() => {
      void fetchOverview();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchOverview]);

  const handleAgentClick = useCallback(async (windowLabel: string, tabId: string, paneId: string) => {
    try {
      await invoke("focus_pane_in_window", {
        windowLabel,
        tabId,
        paneId,
      });

      // Close overview window after clicking
      const overviewWindow = await getCurrentWindow();
      await overviewWindow.close();
    } catch (err) {
      console.error("[Overview] Failed to focus pane:", err);
    }
  }, []);

  const handleWindowClick = useCallback(async (_windowLabel: string) => {
    try {
      // TODO: Implement window activation
      // For now, just close the overview
      const overviewWindow = await getCurrentWindow();
      await overviewWindow.close();
    } catch (err) {
      console.error("[Overview] Failed to focus window:", err);
    }
  }, []);

  if (isLoading) {
    console.log("[Overview] Rendering loading state");
    return (
      <div className="overview-loading">
        <div className="overview-spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (error) {
    console.log("[Overview] Rendering error state:", error);
    return (
      <div className="overview-error">
        <span className="overview-error-icon">⚠️</span>
        <span>{error}</span>
      </div>
    );
  }

  if (!overviewData || overviewData.windows.length === 0) {
    console.log("[Overview] Rendering empty state, windows:", overviewData?.windows?.length);
    return (
      <div className="overview-empty">
        <span className="overview-empty-icon">🤖</span>
        <span className="overview-empty-title">No agents running</span>
        <span className="overview-empty-subtitle">Start an AI agent in any Tome window</span>
      </div>
    );
  }

  console.log("[Overview] Rendering with data:", overviewData);

  const { stats, windows } = overviewData;
  const activeAgents = stats.running_count + stats.waiting_input_count;

  return (
    <div className="overview-container">
      {/* Header with stats */}
      <div className="overview-header">
        <div className="overview-title-row">
          <h1 className="overview-title">Agent Overview</h1>
          {activeAgents > 0 && (
            <span className="overview-badge">{activeAgents}</span>
          )}
        </div>
        <div className="overview-stats">
          <StatBadge count={stats.running_count} label="running" color="green" />
          <StatBadge count={stats.waiting_input_count} label="waiting" color="yellow" />
          <StatBadge count={stats.idle_count} label="idle" color="gray" />
          {stats.error_count > 0 && (
            <StatBadge count={stats.error_count} label="error" color="red" />
          )}
        </div>
        {stats.last_activity_at && (
          <div className="overview-activity">
            Last activity {formatTimeAgo(stats.last_activity_at)}
          </div>
        )}
      </div>

      {/* Window groups */}
      <div className="overview-windows">
        {windows.map((window) => (
          <WindowGroup
            key={window.window_label}
            window={window}
            onAgentClick={handleAgentClick}
            onWindowClick={handleWindowClick}
          />
        ))}
      </div>
    </div>
  );
}

interface StatBadgeProps {
  count: number;
  label: string;
  color: "green" | "yellow" | "gray" | "red";
}

function StatBadge({ count, label, color }: StatBadgeProps) {
  if (count === 0) return null;

  return (
    <div className={`stat-badge stat-badge-${color}`}>
      <span className="stat-badge-count">{count}</span>
      <span className="stat-badge-label">{label}</span>
    </div>
  );
}

interface WindowGroupProps {
  window: WindowSnapshot;
  onAgentClick: (windowLabel: string, tabId: string, paneId: string) => void;
  onWindowClick: (windowLabel: string) => void;
}

function WindowGroup({ window, onAgentClick, onWindowClick }: WindowGroupProps) {
  // Count agents in this window
  const agentCount = window.tabs.reduce(
    (count, tab) => count + tab.panes.filter((p) => p.agent_kind !== null).length,
    0
  );

  const activeCount = window.tabs.reduce(
    (count, tab) =>
      count +
      tab.panes.filter((p) => p.agent_kind !== null && p.agent_status === "running").length,
    0
  );

  return (
    <div className={`window-group ${window.is_focused ? "window-group-focused" : ""}`}>
      <button
        className="window-group-header"
        onClick={() => onWindowClick(window.window_label)}
      >
        <div className="window-group-meta">
          {agentCount > 0 ? (
            <span>
              {agentCount} agent{agentCount > 1 ? "s" : ""}
              {activeCount > 0 && ` · ${activeCount} active`}
            </span>
          ) : (
            <span>No agents</span>
          )}
          <span className="window-group-meta-divider">·</span>
          <span>
            {window.tabs.length} tab{window.tabs.length > 1 ? "s" : ""}
          </span>
          {window.is_focused && <span className="window-group-focus-badge">Focused</span>}
        </div>
      </button>

      <div className="window-group-content">
        {window.tabs.map((tab) => (
          <TabSection
            key={tab.tab_id}
            tab={tab}
            windowLabel={window.window_label}
            onAgentClick={onAgentClick}
          />
        ))}
      </div>
    </div>
  );
}

interface TabSectionProps {
  tab: TabSnapshot;
  windowLabel: string;
  onAgentClick: (windowLabel: string, tabId: string, paneId: string) => void;
}

function TabSection({ tab, windowLabel, onAgentClick }: TabSectionProps) {
  // Filter panes with agents
  const agentPanes = tab.panes.filter((p) => p.agent_kind !== null);

  if (agentPanes.length === 0) {
    return null;
  }

  return (
    <div className="tab-section">
      <div className="tab-section-header">
        <span className="tab-section-label">{tab.tab_label}</span>
      </div>
      <div className="tab-section-panes">
        {agentPanes.map((pane) => (
          <AgentCard
            key={pane.pane_id}
            pane={pane}
            onClick={() => onAgentClick(windowLabel, tab.tab_id, pane.pane_id)}
          />
        ))}
      </div>
    </div>
  );
}

interface AgentCardProps {
  pane: PaneSnapshot;
  onClick: () => void;
}

function AgentCard({ pane, onClick }: AgentCardProps) {
  const agentKind = pane.agent_kind;

  // Debug logging
  console.log("[AgentCard] pane data:", {
    pane_id: pane.pane_id,
    agent_kind: pane.agent_kind,
    total_rounds: pane.total_rounds,
    recent_conversations: pane.recent_conversations,
  });

  // Guard against null agent_kind
  if (!agentKind) {
    return null;
  }

  const agentLabel = AGENT_LABELS[agentKind];
  const agentToken = AGENT_TOKENS[agentKind];

  return (
    <button className="agent-card" onClick={onClick} title={`${agentLabel} - Click to focus`}>
      <div className="agent-card-header">
        <div className="agent-card-logo">{agentToken}</div>
        <div className="agent-card-info">
          <span className="agent-card-name">{agentLabel}</span>
          <StatusPill status={pane.agent_status} />
        </div>
      </div>

      {pane.cwd && (
        <div className="agent-card-directory" title={pane.cwd}>
          <span className="agent-card-directory-icon">📁</span>
          <span className="agent-card-directory-path">{getDirectoryName(pane.cwd)}</span>
        </div>
      )}

      {/* Display conversation rounds count */}
      {pane.total_rounds > 0 && (
        <div className="conversation-rounds-badge">
          {pane.total_rounds} 轮对话
        </div>
      )}

      {/* Display recent conversations */}
      {pane.recent_conversations.length > 0 && (
        <div className="conversation-preview">
          {pane.recent_conversations.map((round, index) => (
            <div key={index} className="conversation-round">
              {round.user_input && (
                <div className="user-message">
                  <span className="message-label">You:</span>
                  <span className="message-content">{round.user_input}</span>
                </div>
              )}
              {round.agent_response && (
                <div className="agent-message">
                  <span className="message-label">Agent:</span>
                  <span className="message-content">{round.agent_response}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="agent-card-footer">
        <span className="agent-card-time">{formatTimeAgo(pane.last_activity_at)}</span>
        {pane.is_focused && <span className="agent-card-focused-badge">Focused</span>}
      </div>
    </button>
  );
}

function StatusPill({ status }: { status: AgentStatus }) {
  const statusConfig: Record<AgentStatus, { label: string; class: string }> = {
    running: { label: "Running", class: "status-running" },
    waiting_input: { label: "Waiting", class: "status-waiting" },
    idle: { label: "Idle", class: "status-idle" },
    error: { label: "Error", class: "status-error" },
    unknown: { label: "Unknown", class: "status-unknown" },
  };

  const config = statusConfig[status];

  // Guard against unexpected status values
  if (!config) {
    console.error(`[StatusPill] Unexpected status: ${status}`);
    return <span className="status-pill status-unknown">Unknown</span>;
  }

  return <span className={`status-pill ${config.class}`}>{config.label}</span>;
}

function getDirectoryName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
