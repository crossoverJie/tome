import { useRef, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface FullscreenTerminalProps {
  visible: boolean;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  rawOutput: string;
}

export function FullscreenTerminal({
  visible,
  onData,
  onResize,
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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
    };
  }, [onData, onResize]);

  // Fit when visibility changes
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
      }, 50);
    }
  }, [visible]);

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
    <div
      className={`fullscreen-terminal ${visible ? "visible" : "hidden"}`}
      ref={containerRef}
    />
  );
}
