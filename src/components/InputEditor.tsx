import { useRef, useEffect, useCallback, useState } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";

interface InputEditorProps {
  onSubmit: (command: string) => void;
  disabled?: boolean;
}

export function InputEditor({ onSubmit, disabled }: InputEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");

  const handleSubmit = useCallback(
    (view: EditorView) => {
      const value = view.state.doc.toString();
      if (value.trim()) {
        onSubmit(value + "\n");
        setHistory((prev) => [...prev, value]);
        historyIndexRef.current = -1;
        savedInputRef.current = "";
      } else {
        onSubmit("\n");
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
      });
      return true;
    },
    [onSubmit]
  );

  const handleHistoryUp = useCallback(
    (view: EditorView) => {
      if (history.length === 0) return false;
      if (historyIndexRef.current === -1) {
        savedInputRef.current = view.state.doc.toString();
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      } else {
        return true;
      }
      const cmd = history[historyIndexRef.current];
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: cmd },
        selection: { anchor: cmd.length },
      });
      return true;
    },
    [history]
  );

  const handleHistoryDown = useCallback(
    (view: EditorView) => {
      if (historyIndexRef.current === -1) return false;
      historyIndexRef.current++;
      let text: string;
      if (historyIndexRef.current >= history.length) {
        historyIndexRef.current = -1;
        text = savedInputRef.current;
      } else {
        text = history[historyIndexRef.current];
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      });
      return true;
    },
    [history]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: "",
      extensions: [
        keymap.of([
          {
            key: "Enter",
            run: (view) => handleSubmit(view),
          },
          {
            key: "Shift-Enter",
            run: () => false, // Let default newline behavior happen
          },
          {
            key: "ArrowUp",
            run: (view) => handleHistoryUp(view),
          },
          {
            key: "ArrowDown",
            run: (view) => handleHistoryDown(view),
          },
        ]),
        placeholder("Type a command..."),
        EditorView.theme({
          "&": {
            fontSize: "14px",
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          },
          ".cm-content": {
            padding: "8px 12px",
            caretColor: "#d4d4d4",
            color: "#d4d4d4",
          },
          "&.cm-focused .cm-cursor": {
            borderLeftColor: "#d4d4d4",
          },
          ".cm-placeholder": {
            color: "#666",
          },
          "&.cm-focused": {
            outline: "none",
          },
        }),
        EditorView.baseTheme({
          ".cm-scroller": {
            overflow: "auto",
            maxHeight: "150px",
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
    };
  }, [handleSubmit, handleHistoryUp, handleHistoryDown]);

  return (
    <div className={`input-editor ${disabled ? "disabled" : ""}`}>
      <span className="input-prompt">$</span>
      <div className="input-editor-container" ref={containerRef} />
    </div>
  );
}
