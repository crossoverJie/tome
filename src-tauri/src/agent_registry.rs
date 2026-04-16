use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Agent status enum for menu bar overview
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Running,
    WaitingInput,
    Idle,
    Error,
    Unknown,
}

/// Conversation round preview for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationRoundPreview {
    pub user_input: String,
    pub agent_response: String,
}

/// Pane snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneSnapshot {
    pub pane_id: String,
    pub cwd: Option<String>,
    pub agent_kind: Option<String>,
    pub agent_status: AgentStatus,
    pub is_focused: bool,
    pub last_activity_at: u64,
    // Conversation tracking for Agent Overview
    pub total_rounds: u32,
    pub recent_conversations: Vec<ConversationRoundPreview>,
    pub session_id: Option<String>,
}

/// Tab snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabSnapshot {
    pub tab_id: String,
    pub tab_label: String,
    pub root_pane_id: String,
    pub focused_pane_id: Option<String>,
    pub panes: Vec<PaneSnapshot>,
}

/// Window snapshot - complete state of a single window
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSnapshot {
    pub window_label: String,
    pub window_title: String,
    pub is_focused: bool,
    pub updated_at: u64,
    pub tabs: Vec<TabSnapshot>,
}

/// Aggregated agent statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStats {
    pub total_agents: usize,
    pub running_count: usize,
    pub waiting_input_count: usize,
    pub idle_count: usize,
    pub error_count: usize,
    pub unknown_count: usize,
    pub last_activity_at: Option<u64>,
}

/// Agent overview data for menu bar
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOverviewData {
    pub stats: AgentStats,
    pub windows: Vec<WindowSnapshot>,
}

/// Global registry for tracking agent state across all windows
#[derive(Debug, Default)]
pub struct AgentWorkspaceRegistry {
    windows: Mutex<HashMap<String, WindowSnapshot>>,
}

impl AgentWorkspaceRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// Update or insert a window snapshot
    pub fn update_window(&self, snapshot: WindowSnapshot) {
        let mut windows = self.windows.lock().unwrap();
        windows.insert(snapshot.window_label.clone(), snapshot);
    }

    /// Remove a window from the registry
    pub fn remove_window(&self, window_label: &str) {
        let mut windows = self.windows.lock().unwrap();
        windows.remove(window_label);
    }

    /// Get a specific window snapshot
    pub fn get_window(&self, window_label: &str) -> Option<WindowSnapshot> {
        let windows = self.windows.lock().unwrap();
        windows.get(window_label).cloned()
    }

    /// Get all window snapshots
    pub fn get_all_windows(&self) -> Vec<WindowSnapshot> {
        let windows = self.windows.lock().unwrap();
        windows.values().cloned().collect()
    }

    /// Calculate aggregated agent statistics
    pub fn get_stats(&self) -> AgentStats {
        let windows = self.windows.lock().unwrap();
        let mut stats = AgentStats {
            total_agents: 0,
            running_count: 0,
            waiting_input_count: 0,
            idle_count: 0,
            error_count: 0,
            unknown_count: 0,
            last_activity_at: None,
        };

        let mut global_last_activity: Option<u64> = None;

        for window in windows.values() {
            for tab in &window.tabs {
                for pane in &tab.panes {
                    if pane.agent_kind.is_some() {
                        stats.total_agents += 1;
                        match pane.agent_status {
                            AgentStatus::Running => stats.running_count += 1,
                            AgentStatus::WaitingInput => stats.waiting_input_count += 1,
                            AgentStatus::Idle => stats.idle_count += 1,
                            AgentStatus::Error => stats.error_count += 1,
                            AgentStatus::Unknown => stats.unknown_count += 1,
                        }

                        // Track last activity
                        if let Some(last) = global_last_activity {
                            if pane.last_activity_at > last {
                                global_last_activity = Some(pane.last_activity_at);
                            }
                        } else {
                            global_last_activity = Some(pane.last_activity_at);
                        }
                    }
                }
            }
        }

        stats.last_activity_at = global_last_activity;
        stats
    }

    /// Get full agent overview data
    pub fn get_overview(&self) -> AgentOverviewData {
        let windows = self.get_all_windows();
        let stats = self.get_stats();

        AgentOverviewData { stats, windows }
    }

    /// Clean up stale windows (those not updated for a long time)
    /// Returns the number of windows removed
    pub fn cleanup_stale_windows(&self, max_age_seconds: u64) -> usize {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();

        let mut windows = self.windows.lock().unwrap();
        let stale_labels: Vec<String> = windows
            .iter()
            .filter(|(_, snapshot)| {
                let age_seconds = (now * 1000).saturating_sub(snapshot.updated_at) / 1000;
                age_seconds > max_age_seconds
            })
            .map(|(label, _)| label.clone())
            .collect();

        for label in &stale_labels {
            windows.remove(label);
        }

        stale_labels.len()
    }

    /// Check if there are any active (running or waiting_input) agents
    pub fn has_active_agents(&self) -> bool {
        let windows = self.windows.lock().unwrap();
        for window in windows.values() {
            for tab in &window.tabs {
                for pane in &tab.panes {
                    if pane.agent_kind.is_some()
                        && (pane.agent_status == AgentStatus::Running
                            || pane.agent_status == AgentStatus::WaitingInput)
                    {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Get the count of active agents
    pub fn active_agent_count(&self) -> usize {
        let windows = self.windows.lock().unwrap();
        let mut count = 0;
        for window in windows.values() {
            for tab in &window.tabs {
                for pane in &tab.panes {
                    if pane.agent_kind.is_some()
                        && (pane.agent_status == AgentStatus::Running
                            || pane.agent_status == AgentStatus::WaitingInput)
                    {
                        count += 1;
                    }
                }
            }
        }
        count
    }

    /// Check if there are any agents in error state
    pub fn has_error_agents(&self) -> bool {
        let windows = self.windows.lock().unwrap();
        for window in windows.values() {
            for tab in &window.tabs {
                for pane in &tab.panes {
                    if pane.agent_status == AgentStatus::Error {
                        return true;
                    }
                }
            }
        }
        false
    }
}

impl AgentWorkspaceRegistry {
    /// Create a new Arc-wrapped registry (for sharing across threads)
    pub fn new_arc() -> Arc<Self> {
        Arc::new(Self::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_pane(
        pane_id: &str,
        agent_kind: Option<&str>,
        status: AgentStatus,
    ) -> PaneSnapshot {
        PaneSnapshot {
            pane_id: pane_id.to_string(),
            cwd: Some("/test".to_string()),
            agent_kind: agent_kind.map(|s| s.to_string()),
            agent_status: status,
            is_focused: false,
            last_activity_at: 1000,
            preview_text: "test output".to_string(),
            session_id: None,
        }
    }

    fn create_test_tab(tab_id: &str, panes: Vec<PaneSnapshot>) -> TabSnapshot {
        TabSnapshot {
            tab_id: tab_id.to_string(),
            tab_label: "Test Tab".to_string(),
            root_pane_id: "pane-1".to_string(),
            focused_pane_id: None,
            panes,
        }
    }

    fn create_test_window(window_label: &str, tabs: Vec<TabSnapshot>) -> WindowSnapshot {
        WindowSnapshot {
            window_label: window_label.to_string(),
            window_title: "Test Window".to_string(),
            is_focused: true,
            updated_at: 1000,
            tabs,
        }
    }

    #[test]
    fn test_update_and_get_window() {
        let registry = AgentWorkspaceRegistry::new();
        let pane = create_test_pane("pane-1", Some("claude"), AgentStatus::Running);
        let tab = create_test_tab("tab-1", vec![pane]);
        let window = create_test_window("window-1", vec![tab]);

        registry.update_window(window.clone());
        let retrieved = registry.get_window("window-1").unwrap();

        assert_eq!(retrieved.window_label, "window-1");
        assert_eq!(retrieved.tabs.len(), 1);
    }

    #[test]
    fn test_remove_window() {
        let registry = AgentWorkspaceRegistry::new();
        let pane = create_test_pane("pane-1", Some("claude"), AgentStatus::Running);
        let tab = create_test_tab("tab-1", vec![pane]);
        let window = create_test_window("window-1", vec![tab]);

        registry.update_window(window);
        registry.remove_window("window-1");

        assert!(registry.get_window("window-1").is_none());
    }

    #[test]
    fn test_get_stats() {
        let registry = AgentWorkspaceRegistry::new();

        // Window 1: 1 running claude, 1 idle codex
        let pane1 = create_test_pane("pane-1", Some("claude"), AgentStatus::Running);
        let pane2 = create_test_pane("pane-2", Some("codex"), AgentStatus::Idle);
        let tab1 = create_test_tab("tab-1", vec![pane1, pane2]);
        let window1 = create_test_window("window-1", vec![tab1]);

        // Window 2: 1 running opencode
        let pane3 = create_test_pane("pane-3", Some("opencode"), AgentStatus::Running);
        let tab2 = create_test_tab("tab-2", vec![pane3]);
        let window2 = create_test_window("window-2", vec![tab2]);

        registry.update_window(window1);
        registry.update_window(window2);

        let stats = registry.get_stats();

        assert_eq!(stats.total_agents, 3);
        assert_eq!(stats.running_count, 2);
        assert_eq!(stats.idle_count, 1);
    }

    #[test]
    fn test_has_active_agents() {
        let registry = AgentWorkspaceRegistry::new();

        // Window with idle agent
        let pane = create_test_pane("pane-1", Some("claude"), AgentStatus::Idle);
        let tab = create_test_tab("tab-1", vec![pane]);
        let window = create_test_window("window-1", vec![tab]);
        registry.update_window(window);

        assert!(!registry.has_active_agents());

        // Window with running agent
        let pane2 = create_test_pane("pane-2", Some("codex"), AgentStatus::Running);
        let tab2 = create_test_tab("tab-2", vec![pane2]);
        let window2 = create_test_window("window-2", vec![tab2]);
        registry.update_window(window2);

        assert!(registry.has_active_agents());
    }

    #[test]
    fn test_active_agent_count() {
        let registry = AgentWorkspaceRegistry::new();

        let pane1 = create_test_pane("pane-1", Some("claude"), AgentStatus::Running);
        let pane2 = create_test_pane("pane-2", Some("codex"), AgentStatus::Running);
        let pane3 = create_test_pane("pane-3", Some("opencode"), AgentStatus::Idle);
        let tab = create_test_tab("tab-1", vec![pane1, pane2, pane3]);
        let window = create_test_window("window-1", vec![tab]);
        registry.update_window(window);

        assert_eq!(registry.active_agent_count(), 2);
    }

    #[test]
    fn test_cleanup_stale_windows() {
        let registry = AgentWorkspaceRegistry::new();

        // Create a window with old timestamp
        let pane = create_test_pane("pane-1", Some("claude"), AgentStatus::Running);
        let tab = create_test_tab("tab-1", vec![pane]);
        let mut window = create_test_window("window-1", vec![tab]);
        window.updated_at = 0; // Very old timestamp

        registry.update_window(window);
        assert_eq!(registry.get_all_windows().len(), 1);

        // Cleanup windows older than 60 seconds
        let removed = registry.cleanup_stale_windows(60);
        assert_eq!(removed, 1);
        assert_eq!(registry.get_all_windows().len(), 0);
    }
}
