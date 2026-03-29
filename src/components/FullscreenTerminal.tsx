import { useRef, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface FullscreenTerminalProps {
  visible: boolean;
  startOffset: number;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (cols: number, rows: number) => void;
  rawOutput: string;
}

export function FullscreenTerminal({
  visible,
  startOffset,
  onData,
  onResize,
  onReady,
  rawOutput,
}: FullscreenTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastWrittenRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 14,
      theme: {
        background: "#1a1a2e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
      },
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    terminal.onData((data) => {
      onData(data);
    });

    terminal.onResize(({ cols, rows }) => {
      onResize(cols, rows);
    });

    // Handle Cmd+Backspace (Cmd+Del on macOS) to delete to beginning of line
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.metaKey && event.key === "Backspace") {
        // Send Ctrl+U (0x15) which deletes from cursor to beginning of line
        onData("\x15");
        return false;
      }
      return true;
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
    };
  }, [onData, onResize]);

  // Fit and focus when visibility changes
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      terminalRef.current?.reset();
      lastWrittenRef.current = startOffset;
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (terminalRef.current) {
          onReady(terminalRef.current.cols, terminalRef.current.rows);
        }
        terminalRef.current?.focus();
      }, 50);
    }
  }, [onReady, startOffset, visible]);

  // Write raw output to xterm when in fullscreen mode
  useEffect(() => {
    if (visible && terminalRef.current && rawOutput.length > lastWrittenRef.current) {
      const newData = rawOutput.slice(lastWrittenRef.current);
      terminalRef.current.write(newData);
      lastWrittenRef.current = rawOutput.length;
    }
  }, [visible, rawOutput]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (visible && fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [visible]);

  return (
    <div className={`fullscreen-terminal ${visible ? "visible" : "hidden"}`} ref={containerRef} />
  );
}
