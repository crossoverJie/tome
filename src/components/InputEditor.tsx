import { useRef, useEffect, useCallback, useState, type MouseEvent } from "react";
import { Decoration, EditorView, WidgetType, keymap, placeholder } from "@codemirror/view";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { shellLanguage } from "./shellLanguage";
import { shellSyntaxHighlighting } from "./shellHighlight";
import { shellValidation, type CheckCommandExists, type CheckPathExists } from "./shellValidation";
import { useCommandHistory } from "../hooks/useCommandHistory";
import type { CompletionItem, CompletionResponse } from "../types/completion";
import {
  applyCompletionValue,
  cycleCompletionIndex,
  decideCompletionAction,
} from "./inputCompletion";
import {
  getHistoryMatches,
  getInlineHistorySuggestion,
  type InlineHistorySuggestion,
  navigateHistoryMatches,
} from "./inputHistory";

interface InputEditorProps {
  onSubmit: (command: string) => void;
  onRequestCompletion: (text: string, cursor: number) => Promise<CompletionResponse>;
  onCheckCommandExists?: CheckCommandExists;
  onCheckPathExists?: CheckPathExists;
  disabled?: boolean;
  busy?: boolean;
  gitBranch?: string | null;
  currentDirectory?: string | null;
  hidePrompt?: boolean;
  initialValue?: string;
  // Prompt bar context
  user?: string;
  runtimeVersion?: string | null;
}

interface CompletionState {
  open: boolean;
  items: CompletionItem[];
  selectedIndex: number;
  replaceFrom: number;
  replaceTo: number;
}

type HistoryNavigationMode = "idle" | "browse" | "search";

interface HistorySearchState {
  active: boolean;
  prefix: string;
  matches: string[];
  index: number;
  savedInput: string;
}

const EMPTY_COMPLETION_STATE: CompletionState = {
  open: false,
  items: [],
  selectedIndex: 0,
  replaceFrom: 0,
  replaceTo: 0,
};

const EMPTY_HISTORY_SEARCH_STATE: HistorySearchState = {
  active: false,
  prefix: "",
  matches: [],
  index: -1,
  savedInput: "",
};

class InlineSuggestionWidget extends WidgetType {
  constructor(private readonly suffix: string) {
    super();
  }

  eq(other: InlineSuggestionWidget) {
    return other.suffix === this.suffix;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "input-inline-suggestion";
    element.textContent = this.suffix;
    return element;
  }
}

const setInlineSuggestionDecorations = StateEffect.define<{
  position: number;
  suffix: string;
} | null>();

const inlineSuggestionField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (!effect.is(setInlineSuggestionDecorations)) {
        continue;
      }

      if (!effect.value) {
        decorations = Decoration.none;
        continue;
      }

      const builder = new RangeSetBuilder<Decoration>();
      builder.add(
        effect.value.position,
        effect.value.position,
        Decoration.widget({
          side: 1,
          widget: new InlineSuggestionWidget(effect.value.suffix),
        })
      );
      decorations = builder.finish();
    }

    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function InputEditor({
  onSubmit,
  onRequestCompletion,
  onCheckCommandExists,
  onCheckPathExists,
  disabled,
  busy,
  gitBranch,
  currentDirectory,
  hidePrompt,
  initialValue,
  user,
  runtimeVersion,
}: InputEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { history, addCommand } = useCommandHistory();
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");
  const requestSequenceRef = useRef(0);
  const applyingCompletionRef = useRef(false);
  const applyingHistoryNavigationRef = useRef(false);
  const disabledRef = useRef(Boolean(disabled));
  const historyRef = useRef(history);
  const historyModeRef = useRef<HistoryNavigationMode>("idle");
  const historySearchRef = useRef<HistorySearchState>(EMPTY_HISTORY_SEARCH_STATE);
  const inlineSuggestionRef = useRef<{
    position: number;
    suggestion: InlineHistorySuggestion;
  } | null>(null);
  const addCommandRef = useRef(addCommand);
  const onSubmitRef = useRef(onSubmit);
  const onRequestCompletionRef = useRef(onRequestCompletion);
  const onCheckCommandExistsRef = useRef(onCheckCommandExists);
  const onCheckPathExistsRef = useRef(onCheckPathExists);
  const currentDirectoryRef = useRef(currentDirectory ?? null);
  const [completionState, setCompletionState] = useState<CompletionState>(EMPTY_COMPLETION_STATE);
  const completionStateRef = useRef(completionState);

  useEffect(() => {
    completionStateRef.current = completionState;
  }, [completionState]);

  useEffect(() => {
    disabledRef.current = Boolean(disabled);
  }, [disabled]);

  useEffect(() => {
    historyRef.current = history;
    const view = viewRef.current;
    if (view) {
      refreshInlineSuggestion(view);
    }
  }, [history]);

  useEffect(() => {
    addCommandRef.current = addCommand;
  }, [addCommand]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    onRequestCompletionRef.current = onRequestCompletion;
  }, [onRequestCompletion]);

  useEffect(() => {
    currentDirectoryRef.current = currentDirectory ?? null;
  }, [currentDirectory]);

  useEffect(() => {
    onCheckCommandExistsRef.current = onCheckCommandExists;
  }, [onCheckCommandExists]);

  useEffect(() => {
    onCheckPathExistsRef.current = onCheckPathExists;
  }, [onCheckPathExists]);

  useEffect(() => {
    if (!disabled && viewRef.current) {
      viewRef.current.focus();
    }
  }, [disabled]);

  // Update editor content when initialValue changes (e.g., when clicking a directory in welcome page)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || initialValue === undefined) {
      return;
    }
    const currentText = view.state.doc.toString();
    if (currentText === initialValue) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialValue },
      selection: { anchor: initialValue.length },
    });
  }, [initialValue]);

  const closeCompletion = useCallback(() => {
    requestSequenceRef.current += 1;
    setCompletionState(EMPTY_COMPLETION_STATE);
  }, []);

  const resetHistoryNavigation = useCallback(() => {
    historyModeRef.current = "idle";
    historyIndexRef.current = -1;
    savedInputRef.current = "";
    historySearchRef.current = EMPTY_HISTORY_SEARCH_STATE;
  }, []);

  const setInlineSuggestion = useCallback(
    (
      view: EditorView,
      suggestion: { position: number; suggestion: InlineHistorySuggestion } | null
    ) => {
      const current = inlineSuggestionRef.current;
      const isSame =
        current?.position === suggestion?.position &&
        current?.suggestion.fullCommand === suggestion?.suggestion.fullCommand &&
        current?.suggestion.suffix === suggestion?.suggestion.suffix;

      if (isSame) {
        return;
      }

      inlineSuggestionRef.current = suggestion;
      view.dispatch({
        effects: setInlineSuggestionDecorations.of(
          suggestion
            ? {
                position: suggestion.position,
                suffix: suggestion.suggestion.suffix,
              }
            : null
        ),
      });
    },
    []
  );

  const refreshInlineSuggestion = useCallback(
    (view: EditorView) => {
      if (completionStateRef.current.open) {
        setInlineSuggestion(view, null);
        return;
      }

      const text = view.state.doc.toString();
      const cursor = view.state.selection.main.head;
      const suggestion = getInlineHistorySuggestion(historyRef.current, text, cursor);

      if (!suggestion) {
        setInlineSuggestion(view, null);
        return;
      }

      setInlineSuggestion(view, {
        position: cursor,
        suggestion,
      });
    },
    [setInlineSuggestion]
  );

  const replaceEditorText = useCallback(
    (view: EditorView, text: string) => {
      applyingHistoryNavigationRef.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      });
      queueMicrotask(() => {
        applyingHistoryNavigationRef.current = false;
        refreshInlineSuggestion(view);
      });
    },
    [refreshInlineSuggestion]
  );

  useEffect(() => {
    if (disabled) {
      closeCompletion();
      resetHistoryNavigation();
    }
  }, [disabled, closeCompletion, resetHistoryNavigation]);

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
      if (disabledRef.current) {
        return true;
      }

      if (completionStateRef.current.open) {
        const handled = applySelectedCompletion(view);
        if (handled) {
          return true;
        }
      }

      const value = view.state.doc.toString();
      if (value.trim()) {
        onSubmitRef.current(value + "\n");
        void addCommandRef.current(value);
        resetHistoryNavigation();
      } else {
        onSubmitRef.current("\n");
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
      });
      closeCompletion();
      setInlineSuggestion(view, null);
      return true;
    },
    [applySelectedCompletion, closeCompletion, resetHistoryNavigation, setInlineSuggestion]
  );

  const handleHistoryUp = useCallback(
    (view: EditorView) => {
      if (completionStateRef.current.open) {
        moveCompletionSelection(-1);
        return true;
      }

      const text = view.state.doc.toString();
      if (historyModeRef.current === "search") {
        const result = navigateHistoryMatches(
          historySearchRef.current.matches,
          historySearchRef.current.index,
          -1
        );
        if (!result.value) {
          historyModeRef.current = "idle";
          historySearchRef.current = EMPTY_HISTORY_SEARCH_STATE;
          return false;
        }

        historySearchRef.current = {
          ...historySearchRef.current,
          index: result.index,
        };
        replaceEditorText(view, result.value);
        return true;
      }

      if (historyModeRef.current === "browse") {
        if (historyRef.current.length === 0) return false;
        if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
        } else {
          return true;
        }

        const cmd = historyRef.current[historyIndexRef.current];
        replaceEditorText(view, cmd);
        closeCompletion();
        return true;
      }

      if (text.trim()) {
        if (!historySearchRef.current.active) {
          historySearchRef.current = {
            active: true,
            prefix: text,
            matches: getHistoryMatches(historyRef.current, text),
            index: -1,
            savedInput: text,
          };
          historyModeRef.current = "search";
        }

        const result = navigateHistoryMatches(
          historySearchRef.current.matches,
          historySearchRef.current.index,
          -1
        );
        if (!result.value) {
          return false;
        }

        historySearchRef.current = {
          ...historySearchRef.current,
          index: result.index,
        };
        replaceEditorText(view, result.value);
        return true;
      }

      if (historyRef.current.length === 0) return false;
      if (historyIndexRef.current === -1) {
        savedInputRef.current = text;
        historyIndexRef.current = historyRef.current.length - 1;
        historyModeRef.current = "browse";
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      } else {
        return true;
      }
      const cmd = historyRef.current[historyIndexRef.current];
      replaceEditorText(view, cmd);
      closeCompletion();
      return true;
    },
    [closeCompletion, moveCompletionSelection, replaceEditorText]
  );

  const handleHistoryDown = useCallback(
    (view: EditorView) => {
      if (completionStateRef.current.open) {
        moveCompletionSelection(1);
        return true;
      }

      if (historyModeRef.current === "search") {
        const result = navigateHistoryMatches(
          historySearchRef.current.matches,
          historySearchRef.current.index,
          1
        );

        historySearchRef.current = {
          ...historySearchRef.current,
          active: result.index !== -1,
          index: result.index,
        };
        historyModeRef.current = result.index === -1 ? "idle" : "search";

        replaceEditorText(view, result.value ?? historySearchRef.current.savedInput);
        return true;
      }

      if (historyModeRef.current === "browse") {
        if (historyIndexRef.current === -1) return false;
        historyIndexRef.current++;
        let text: string;
        if (historyIndexRef.current >= historyRef.current.length) {
          historyIndexRef.current = -1;
          historyModeRef.current = "idle";
          text = savedInputRef.current;
        } else {
          text = historyRef.current[historyIndexRef.current];
        }
        replaceEditorText(view, text);
        closeCompletion();
        return true;
      }

      return false;
    },
    [closeCompletion, moveCompletionSelection, replaceEditorText]
  );

  const requestEditorCompletion = useCallback(
    (view: EditorView) => {
      if (disabledRef.current) {
        return false;
      }

      const text = view.state.doc.toString();
      const cursor = view.state.selection.main.head;
      const requestId = ++requestSequenceRef.current;

      void onRequestCompletionRef
        .current(text, cursor)
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
    [applyCompletion, closeCompletion]
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

  const handleArrowRight = useCallback(
    (view: EditorView) => {
      const current = inlineSuggestionRef.current;
      if (!current) {
        return false;
      }

      const cursor = view.state.selection.main.head;
      if (cursor !== view.state.doc.length) {
        return false;
      }

      resetHistoryNavigation();
      replaceEditorText(view, current.suggestion.fullCommand);
      return true;
    },
    [replaceEditorText, resetHistoryNavigation]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: initialValue || "",
      extensions: [
        keymap.of([
          {
            key: "Enter",
            run: (view) => handleSubmit(view),
          },
          {
            key: "Shift-Enter",
            run: () => false,
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
            key: "ArrowRight",
            run: (view) => handleArrowRight(view),
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
        shellLanguage,
        shellSyntaxHighlighting,
        inlineSuggestionField,
        ...shellValidation(
          (cmd) => onCheckCommandExistsRef.current?.(cmd) ?? Promise.resolve(true),
          (path, cwd) => onCheckPathExistsRef.current?.(path, cwd) ?? Promise.resolve(true),
          () => currentDirectoryRef.current
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet) {
            if (completionStateRef.current.open && !applyingCompletionRef.current) {
              closeCompletion();
            }

            if (!applyingHistoryNavigationRef.current && !applyingCompletionRef.current) {
              resetHistoryNavigation();
            }

            refreshInlineSuggestion(update.view);
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
          ".input-inline-suggestion": {
            color: "var(--text-muted)",
            opacity: "0.7",
            pointerEvents: "none",
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
    refreshInlineSuggestion(view);

    return () => {
      view.destroy();
    };
  }, [
    handleArrowRight,
    handleEscape,
    handleHistoryDown,
    handleHistoryUp,
    handleShiftTab,
    handleSubmit,
    handleTab,
    refreshInlineSuggestion,
    resetHistoryNavigation,
  ]);

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

  // Get current time for display
  const getCurrentTime = () => {
    const now = new Date();
    return now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  // Get directory label (last part of path)
  const getDirLabel = (cwd: string): string => {
    if (cwd === "~" || cwd === "/Users") return "~";
    const parts = cwd.split("/");
    return parts[parts.length - 1] || cwd;
  };

  return (
    <div className={`input-editor ${disabled ? "disabled" : ""} ${busy ? "busy" : ""}`}>
      {!hidePrompt && (
        <div className="input-prompt-bar">
          {/* User segment */}
          <span className="prompt-segment prompt-segment-user">
            <span className="prompt-icon">🍎</span>
            <span>{user || "user"}</span>
          </span>
          {/* Path segment */}
          <span className="prompt-segment prompt-segment-path">
            <span className="prompt-icon">📁</span>
            <span>~/{currentDirectory ? getDirLabel(currentDirectory) : "~"}</span>
          </span>
          {/* Git branch segment */}
          {gitBranch && (
            <span className="prompt-segment prompt-segment-git">
              <span className="prompt-icon">🌿</span>
              <span>{gitBranch}</span>
            </span>
          )}
          {/* Runtime version segment */}
          {runtimeVersion && (
            <span className="prompt-segment prompt-segment-version">
              <span className="prompt-icon">⚡</span>
              <span>{runtimeVersion}</span>
            </span>
          )}
          {/* Time segment */}
          <span className="prompt-segment prompt-segment-time">
            <span className="prompt-icon">🕐</span>
            <span>{getCurrentTime()}</span>
          </span>
        </div>
      )}
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
      {busy && (
        <span className="input-busy-indicator">
          <span className="running-dot" />
          Command running...
        </span>
      )}
    </div>
  );
}
