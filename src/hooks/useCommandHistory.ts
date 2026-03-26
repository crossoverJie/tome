import { useState, useEffect, useCallback, useRef } from "react";
import { readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

const HISTORY_FILE = "command_history.json";
const MAX_HISTORY_SIZE = 1000;

interface HistoryData {
  version: number;
  commands: string[];
}

interface UseCommandHistoryReturn {
  history: string[];
  addCommand: (command: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useCommandHistory(): UseCommandHistoryReturn {
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  // Load history from file on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    async function loadHistory() {
      try {
        const dataDir = await appDataDir();
        const historyPath = await join(dataDir, HISTORY_FILE);

        try {
          const content = await readTextFile(historyPath);
          const data: HistoryData = JSON.parse(content);

          if (data.version === 1 && Array.isArray(data.commands)) {
            setHistory(data.commands);
          } else {
            // Invalid format, start fresh
            setHistory([]);
          }
        } catch (e) {
          // File doesn't exist or other error, start with empty history
          setHistory([]);
        }
      } catch (e) {
        setError(`Failed to load command history: ${e}`);
        setHistory([]);
      } finally {
        setLoading(false);
      }
    }

    loadHistory();
  }, []);

  // Save history to file
  const saveHistory = useCallback(async (commands: string[]) => {
    try {
      const dataDir = await appDataDir();

      // Ensure directory exists
      try {
        await mkdir(dataDir, { recursive: true });
      } catch (e) {
        // Directory might already exist
      }

      const historyPath = await join(dataDir, HISTORY_FILE);
      const data: HistoryData = {
        version: 1,
        commands,
      };

      await writeTextFile(historyPath, JSON.stringify(data, null, 2));
    } catch (e) {
      setError(`Failed to save command history: ${e}`);
    }
  }, []);

  // Add a new command to history
  const addCommand = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;

      setHistory((prev) => {
        // Skip if this is the same as the last command
        if (prev.length > 0 && prev[prev.length - 1] === trimmed) {
          return prev;
        }

        // Add new command and limit size
        const newHistory = [...prev, trimmed];
        if (newHistory.length > MAX_HISTORY_SIZE) {
          newHistory.shift();
        }

        // Save to file asynchronously
        saveHistory(newHistory);

        return newHistory;
      });
    },
    [saveHistory]
  );

  return { history, addCommand, loading, error };
}
