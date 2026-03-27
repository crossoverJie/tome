import { useRef, useEffect, useCallback, useState, type MouseEvent } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { useCommandHistory } from "../hooks/useCommandHistory";
import type { CompletionItem, CompletionResponse } from "../types/completion";
import {
  applyCompletionValue,
  cycleCompletionIndex,
  decideCompletionAction,
} from "./inputCompletion";

interface InputEditorProps {
  onSubmit: (command: string) => void;
  onRequestCompletion: (text: string, cursor: number) => Promise<CompletionResponse>;
  disabled?: boolean;
  gitBranch?: string | null;
}

interface CompletionState {
  open: boolean;
  items: CompletionItem[];
  selectedIndex: number;
  replaceFrom: number;
  replaceTo: number;
}

const EMPTY_COMPLETION_STATE: CompletionState = {
  open: false,
  items: [],
  selectedIndex: 0,
  replaceFrom: 0,
  replaceTo: 0,
};

export function InputEditor({
  onSubmit,
  onRequestCompletion,
  disabled,
  gitBranch,
}: InputEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { history, addCommand } = useCommandHistory();
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");
  const requestSequenceRef = useRef(0);
  const applyingCompletionRef = useRef(false);
  const [completionState, setCompletionState] = useState<CompletionState>(EMPTY_COMPLETION_STATE);
  const completionStateRef = useRef(completionState);

  useEffect(() => {
    completionStateRef.current = completionState;
  }, [completionState]);

  // Focus editor when enabled (pane becomes focused)
  useEffect(() => {
    if (!disabled && viewRef.current) {
      viewRef.current.focus();
    }
  }, [disabled]);

  const closeCompletion = useCallback(() => {
    requestSequenceRef.current += 1;
    setCompletionState(EMPTY_COMPLETION_STATE);
  }, []);

  useEffect(() => {
    if (disabled) {
      closeCompletion();
    }
  }, [disabled, closeCompletion]);

  const applyCompletion = useCallback(
    (view: EditorView, value: string, replaceFrom: number, replaceTo: number) => {
      const currentText = view.state.doc.toString();
      const next = applyCompletionValue(currentText, replaceFrom, replaceTo, value);
      applyingCompletionRef.current = true;
      view.dispatch({
        changes: { from: replaceFrom, to: replaceTo, insert: value },
        selection: { anchor: next.cursor },
      });
      queueMicrotask(() => {
        applyingCompletionRef.current = false;
      });
      closeCompletion();
      return true;
    },
    [closeCompletion]
  );

  const applySelectedCompletion = useCallback(
    (view: EditorView) => {
      const current = completionStateRef.current;
      if (!current.open) {
        return false;
      }

      const item = current.items[current.selectedIndex];
      if (!item) {
        closeCompletion();
        return true;
      }

      return applyCompletion(view, item.value, current.replaceFrom, current.replaceTo);
    },
    [applyCompletion, closeCompletion]
  );

  const moveCompletionSelection = useCallback((delta: number) => {
    setCompletionState((current) => {
      if (!current.open) {
        return current;
      }

      return {
        ...current,
        selectedIndex: cycleCompletionIndex(current.selectedIndex, delta, current.items.length),
      };
    });
  }, []);

  const handleSubmit = useCallback(
    (view: EditorView) => {
      if (completionStateRef.current.open) {
        return applySelectedCompletion(view);
      }

      const value = view.state.doc.toString();
      if (value.trim()) {
        onSubmit(value + "\n");
        addCommand(value);
        historyIndexRef.current = -1;
        savedInputRef.current = "";
      } else {
        onSubmit("\n");
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
      });
      closeCompletion();
      return true;
    },
    [addCommand, applySelectedCompletion, closeCompletion, onSubmit]
  );

  const handleHistoryUp = useCallback(
    (view: EditorView) => {
      if (completionStateRef.current.open) {
        moveCompletionSelection(-1);
        return true;
      }

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
      closeCompletion();
      return true;
    },
    [closeCompletion, history, moveCompletionSelection]
  );

  const handleHistoryDown = useCallback(
    (view: EditorView) => {
      if (completionStateRef.current.open) {
        moveCompletionSelection(1);
        return true;
      }

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
      closeCompletion();
      return true;
    },
    [closeCompletion, history, moveCompletionSelection]
  );

  const requestEditorCompletion = useCallback(
    (view: EditorView) => {
      if (disabled) {
        return false;
      }

      const text = view.state.doc.toString();
      const cursor = view.state.selection.main.head;
      const requestId = ++requestSequenceRef.current;

      void onRequestCompletion(text, cursor)
        .then((response) => {
          if (requestSequenceRef.current !== requestId) {
            return;
          }

          const liveView = viewRef.current;
          if (!liveView) {
            return;
          }

          if (
            liveView.state.doc.toString() !== text ||
            liveView.state.selection.main.head !== cursor
          ) {
            return;
          }

          const decision = decideCompletionAction(response, text, cursor);

          switch (decision.kind) {
            case "noop":
              closeCompletion();
              return;
            case "apply":
              applyCompletion(liveView, decision.value, decision.replaceFrom, decision.replaceTo);
              return;
            case "open":
              setCompletionState({
                open: true,
                items: decision.items,
                selectedIndex: 0,
                replaceFrom: decision.replaceFrom,
                replaceTo: decision.replaceTo,
              });
              return;
          }
        })
        .catch(() => {
          if (requestSequenceRef.current === requestId) {
            closeCompletion();
          }
        });

      return true;
    },
    [applyCompletion, closeCompletion, disabled, onRequestCompletion]
  );

  const handleTab = useCallback(
    (view: EditorView) => {
      if (completionStateRef.current.open) {
        moveCompletionSelection(1);
        return true;
      }

      return requestEditorCompletion(view);
    },
    [moveCompletionSelection, requestEditorCompletion]
  );

  const handleShiftTab = useCallback(() => {
    if (!completionStateRef.current.open) {
      return false;
    }

    moveCompletionSelection(-1);
    return true;
  }, [moveCompletionSelection]);

  const handleEscape = useCallback(() => {
    if (!completionStateRef.current.open) {
      return false;
    }

    closeCompletion();
    return true;
  }, [closeCompletion]);

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
          {
            key: "Tab",
            run: (view) => handleTab(view),
          },
          {
            key: "Shift-Tab",
            run: () => handleShiftTab(),
          },
          {
            key: "Escape",
            run: () => handleEscape(),
          },
        ]),
        placeholder("Type a command..."),
        EditorView.updateListener.of((update) => {
          if (!completionStateRef.current.open || applyingCompletionRef.current) {
            return;
          }

          if (update.docChanged || update.selectionSet) {
            closeCompletion();
          }
        }),
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
  }, [handleEscape, handleHistoryDown, handleHistoryUp, handleShiftTab, handleSubmit, handleTab]);

  const handleMenuItemMouseDown = useCallback(
    (index: number) => (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setCompletionState((current) => ({
        ...current,
        selectedIndex: index,
      }));

      const view = viewRef.current;
      if (!view) {
        return;
      }

      const item = completionStateRef.current.items[index];
      if (!item) {
        return;
      }

      applyCompletion(
        view,
        item.value,
        completionStateRef.current.replaceFrom,
        completionStateRef.current.replaceTo
      );
    },
    [applyCompletion]
  );

  return (
    <div className={`input-editor ${disabled ? "disabled" : ""}`}>
      <span className="input-prompt">
        ${gitBranch ? <span className="git-branch"> ({gitBranch})</span> : ""}
      </span>
      <div className="input-editor-container" ref={containerRef}>
        {completionState.open && (
          <div className="completion-menu" role="listbox" aria-label="Completion suggestions">
            {completionState.items.map((item, index) => (
              <button
                key={`${item.kind}-${item.value}`}
                type="button"
                className={`completion-menu-item ${
                  index === completionState.selectedIndex ? "selected" : ""
                }`}
                onMouseDown={handleMenuItemMouseDown(index)}
              >
                <span className="completion-menu-value">{item.display}</span>
                <span className="completion-menu-kind">{item.kind}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
