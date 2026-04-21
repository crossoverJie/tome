import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { InputEditor } from "./InputEditor";
import type { CompletionResponse } from "../types/completion";
import "./WelcomeView.css";

interface SystemInfo {
  os: string;
  shell: string;
  cpu?: string;
  memory?: string;
  user: string;
}

export interface RecentDirectoryItem {
  path: string;
  label: string;
  gitBranch: string | null;
  lastUsedAt: number;
}

interface WelcomeViewProps {
  onSubmitCommand: (command: string, targetDirectory?: string) => void;
  recentDirectories: RecentDirectoryItem[];
  currentWorkingDirectory?: string | null;
  onDirectorySelect?: (path: string | null) => void;
  onRequestCompletion: (text: string, cursor: number) => Promise<CompletionResponse>;
  onCheckCommandExists?: (cmd: string) => Promise<boolean>;
  onCheckPathExists?: (path: string, cwd: string) => Promise<boolean>;
}

const STORAGE_KEY = "tome_recent_directories";
const MAX_RECENT_DIRS = 5;

// Shell-escape a path for safe use in cd commands
// Uses backslash escaping to preserve ~ expansion while handling special characters
function shellEscapePath(path: string): string {
  // Escape spaces, quotes and other special characters with backslash
  // This preserves ~ expansion while preventing word splitting and quote issues
  return path.replace(/([\s$`'"\\!*?#[\](){}<>;|&])/g, "\\$1");
}

function formatOS(osString: string): string {
  // Format like "macos aarch64" to "macOS (Apple Silicon)"
  const parts = osString.toLowerCase().split(" ");
  const os = parts[0];
  const arch = parts[1] || "";

  let osName = os;
  if (os === "macos") osName = "macOS";
  else if (os === "linux") osName = "Linux";
  else if (os === "windows") osName = "Windows";

  let archDisplay = "";
  if (arch === "aarch64") archDisplay = "Apple Silicon";
  else if (arch === "x86_64") archDisplay = "Intel";

  return archDisplay ? `${osName} (${archDisplay})` : osName;
}

function formatShell(shell: string): string {
  return shell.charAt(0).toUpperCase() + shell.slice(1);
}

export function WelcomeView({
  onSubmitCommand,
  recentDirectories,
  currentWorkingDirectory,
  onDirectorySelect,
  onRequestCompletion,
  onCheckCommandExists,
  onCheckPathExists,
}: WelcomeViewProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [initialInput, setInitialInput] = useState<string>("");

  // Load system info on mount
  useEffect(() => {
    invoke<SystemInfo>("get_system_info")
      .then((info) => setSystemInfo(info))
      .catch((err) => console.error("Failed to get system info:", err));
  }, []);

  const handleDirectoryClick = useCallback(
    (path: string) => {
      setSelectedDirectory(path);
      onDirectorySelect?.(path);
      // Set cd command as initial input with proper shell escaping
      const cdCommand = `cd ${shellEscapePath(path)}`;
      setInitialInput(cdCommand);
      // Force InputEditor to re-render even if selecting the same directory
      setInputKey((k) => k + 1);
    },
    [onDirectorySelect]
  );

  const handleSubmit = useCallback(
    (command: string) => {
      onSubmitCommand(command, selectedDirectory ?? undefined);
    },
    [onSubmitCommand, selectedDirectory]
  );

  return (
    <div className="welcome-view">
      {/* Draggable title bar region - for Overlay titleBarStyle */}
      <div className="welcome-drag-region" data-tauri-drag-region />

      {/* Background pattern */}
      <div className="welcome-bg-pattern" />

      {/* Main container */}
      <div className="welcome-container">
        {/* Logo Section */}
        <div className="welcome-logo-section">
          <div className="welcome-logo">◈</div>
          <h1 className="welcome-title">Tome</h1>
          <p className="welcome-tagline">&ldquo;Your command, beautifully&rdquo;</p>
        </div>

        {/* System Info Card */}
        <div className="welcome-card">
          <div className="welcome-card-header">
            <span className="welcome-card-icon">◉</span>
            <span className="welcome-card-title">System Info</span>
          </div>
          <div className="welcome-system-grid">
            <div className="welcome-system-item">
              <span className="welcome-system-icon icon-os">🍎</span>
              <div className="welcome-system-info">
                <div className="welcome-system-label">OS</div>
                <div className="welcome-system-value">
                  {systemInfo ? formatOS(systemInfo.os) : "Loading..."}
                </div>
              </div>
            </div>
            <div className="welcome-system-item">
              <span className="welcome-system-icon icon-shell">⌨</span>
              <div className="welcome-system-info">
                <div className="welcome-system-label">Shell</div>
                <div className="welcome-system-value">
                  {systemInfo ? formatShell(systemInfo.shell) : "Loading..."}
                </div>
              </div>
            </div>
            <div className="welcome-system-item">
              <span className="welcome-system-icon icon-cpu">⚙</span>
              <div className="welcome-system-info">
                <div className="welcome-system-label">CPU</div>
                <div className="welcome-system-value">{systemInfo?.cpu || "Unknown"}</div>
              </div>
            </div>
            <div className="welcome-system-item">
              <span className="welcome-system-icon icon-mem">🧠</span>
              <div className="welcome-system-info">
                <div className="welcome-system-label">Memory</div>
                <div className="welcome-system-value">{systemInfo?.memory || "Loading..."}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Directories */}
        {recentDirectories.length > 0 && (
          <div className="welcome-card">
            <div className="welcome-card-header welcome-card-header-muted">
              <span className="welcome-card-icon">📁</span>
              <span className="welcome-card-title">Recent Directories</span>
            </div>
            <div className="welcome-directory-list">
              {recentDirectories.map((dir) => (
                <button
                  key={dir.path}
                  type="button"
                  className={`welcome-directory-item ${
                    selectedDirectory === dir.path ? "selected" : ""
                  }`}
                  onClick={() => handleDirectoryClick(dir.path)}
                >
                  <span className="welcome-directory-arrow">❯</span>
                  <span className="welcome-directory-path">{dir.label}</span>
                  {dir.gitBranch && (
                    <span className="welcome-directory-branch">{dir.gitBranch}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Command Input */}
        <div className="welcome-input-wrapper">
          <div className="welcome-input-box">
            <span className="welcome-input-prompt">❯</span>
            <div className="welcome-input-container">
              <InputEditor
                key={inputKey}
                onSubmit={handleSubmit}
                onRequestCompletion={onRequestCompletion}
                onCheckCommandExists={onCheckCommandExists}
                onCheckPathExists={onCheckPathExists}
                disabled={false}
                busy={false}
                gitBranch={null}
                currentDirectory={currentWorkingDirectory}
                hidePrompt
                initialValue={initialInput}
              />
            </div>
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="welcome-shortcuts">
          <div className="welcome-shortcut">
            <kbd className="welcome-kbd">⌘</kbd>
            <span>+</span>
            <kbd className="welcome-kbd">K</kbd>
            <span className="welcome-shortcut-desc">clear</span>
          </div>
          <div className="welcome-shortcut">
            <kbd className="welcome-kbd">↑</kbd>
            <kbd className="welcome-kbd">↓</kbd>
            <span className="welcome-shortcut-desc">history</span>
          </div>
          <div className="welcome-shortcut">
            <kbd className="welcome-kbd">⌘</kbd>
            <span>+</span>
            <kbd className="welcome-kbd">⇧</kbd>
            <span>+</span>
            <kbd className="welcome-kbd">H</kbd>
            <span className="welcome-shortcut-desc">home</span>
          </div>
        </div>

        {/* Hint */}
        <div className="welcome-hint">
          <span>Type any command and press Enter to start</span>
        </div>
      </div>
    </div>
  );
}

// Helper functions for managing recent directories
export function loadRecentDirectories(): RecentDirectoryItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as RecentDirectoryItem[];
      // Filter out entries older than 30 days
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return parsed.filter((d) => d.lastUsedAt > thirtyDaysAgo).slice(0, MAX_RECENT_DIRS);
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

export function saveRecentDirectories(dirs: RecentDirectoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dirs));
  } catch {
    // Ignore storage errors
  }
}

export function addRecentDirectory(
  current: RecentDirectoryItem[],
  path: string,
  gitBranch: string | null
): RecentDirectoryItem[] {
  const label = path.split("/").pop() || path;

  // Remove existing entry for this path
  const filtered = current.filter((d) => d.path !== path);

  // Add new entry at the beginning
  const newEntry: RecentDirectoryItem = {
    path,
    label,
    gitBranch,
    lastUsedAt: Date.now(),
  };

  return [newEntry, ...filtered].slice(0, MAX_RECENT_DIRS);
}
