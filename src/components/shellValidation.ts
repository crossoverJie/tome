import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

export type CheckCommandExists = (command: string) => Promise<boolean>;
export type CheckPathExists = (path: string, cwd: string) => Promise<boolean>;

export interface ShellToken {
  type: "command" | "path";
  from: number;
  to: number;
  value: string;
}

// Must match shellLanguage.ts keywords exactly.
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "select",
  "return",
  "exit",
  "break",
  "continue",
]);

/**
 * Parse the editor text directly (same logic as shellLanguage.ts) to find
 * command-position tokens and path tokens.  Using direct parsing avoids any
 * dependency on the CodeMirror StreamLanguage syntax tree node-naming internals.
 *
 * Exported for unit testing.
 */
export function extractShellTokens(text: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let pos = 0;
  let expectCommand = true;

  const peek = () => text[pos] ?? "";
  const atEnd = () => pos >= text.length;

  while (!atEnd()) {
    const ch = peek();

    // Whitespace
    if (ch === " " || ch === "\t") {
      pos++;
      continue;
    }

    // Newline → command position
    if (ch === "\n") {
      pos++;
      expectCommand = true;
      continue;
    }

    // Comment → skip to end of line
    if (ch === "#") {
      while (!atEnd() && peek() !== "\n") pos++;
      continue;
    }

    // Double-quoted string
    if (ch === '"') {
      pos++;
      while (!atEnd() && peek() !== '"') {
        if (peek() === "\\") pos++; // skip escaped char
        pos++;
      }
      if (!atEnd()) pos++; // closing "
      expectCommand = false;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      pos++;
      while (!atEnd() && peek() !== "'") pos++;
      if (!atEnd()) pos++; // closing '
      expectCommand = false;
      continue;
    }

    // Variable ${...}
    if (ch === "$" && text[pos + 1] === "{") {
      pos += 2;
      while (!atEnd() && peek() !== "}") pos++;
      if (!atEnd()) pos++; // closing }
      expectCommand = false;
      continue;
    }

    // Variable $word / $special
    if (ch === "$") {
      pos++;
      while (!atEnd() && /[a-zA-Z0-9_*@#?$!]/.test(peek())) pos++;
      expectCommand = false;
      continue;
    }

    // Two-char operators: && || << >> <= >= == !=
    if (pos + 1 < text.length) {
      const two = text.slice(pos, pos + 2);
      if (two === "&&" || two === "||") {
        pos += 2;
        expectCommand = true;
        continue;
      }
      if (
        two === "<<" ||
        two === ">>" ||
        two === "<=" ||
        two === ">=" ||
        two === "==" ||
        two === "!="
      ) {
        pos += 2;
        expectCommand = false;
        continue;
      }
    }

    // Single-char operators
    if (/[|&;<>()\[\]{}]/.test(ch)) {
      pos++;
      expectCommand = ch === "|" || ch === ";" || ch === "&" || ch === "(";
      continue;
    }

    // Flags / options starting with - (not command or path)
    if (ch === "-") {
      while (!atEnd() && !/[\s$"'|&;<>()\[\]{}#]/.test(peek())) pos++;
      expectCommand = false;
      continue;
    }

    // Word token (same char class as shellLanguage.ts)
    const wordStart = pos;
    while (!atEnd() && !/[\s$"'|&;<>()\[\]{}#]/.test(peek())) pos++;
    const word = text.slice(wordStart, pos);

    if (!word) {
      pos++;
      continue;
    }

    if (expectCommand) {
      expectCommand = false;
      if (!SHELL_KEYWORDS.has(word)) {
        tokens.push({ type: "command", from: wordStart, to: pos, value: word });
      }
    } else if (word.includes("/") || word.startsWith(".")) {
      tokens.push({ type: "path", from: wordStart, to: pos, value: word });
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// State field + effect for async decoration updates
// ---------------------------------------------------------------------------

const setValidationDecorations = StateEffect.define<DecorationSet>();

const validationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setValidationDecorations)) {
        deco = effect.value;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// ViewPlugin that drives async validation
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

function createValidationPlugin(
  checkCommandExists: CheckCommandExists,
  checkPathExists: CheckPathExists,
  getCurrentDirectory: () => string | null
) {
  return ViewPlugin.fromClass(
    class {
      private pendingTimer: ReturnType<typeof setTimeout> | null = null;
      private validatedText = "\0"; // sentinel so first non-empty input always validates

      constructor(private view: EditorView) {
        this.scheduleValidation();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.scheduleValidation();
        }
      }

      destroy() {
        if (this.pendingTimer !== null) {
          clearTimeout(this.pendingTimer);
          this.pendingTimer = null;
        }
      }

      private scheduleValidation() {
        if (this.pendingTimer !== null) {
          clearTimeout(this.pendingTimer);
        }
        this.pendingTimer = setTimeout(() => {
          this.pendingTimer = null;
          void this.validate();
        }, DEBOUNCE_MS);
      }

      private async validate() {
        const view = this.view;
        const text = view.state.doc.toString();

        if (text === this.validatedText) return;
        this.validatedText = text;

        if (!text.trim()) {
          view.dispatch({ effects: setValidationDecorations.of(Decoration.none) });
          return;
        }

        const tokens = extractShellTokens(text);
        if (tokens.length === 0) {
          view.dispatch({ effects: setValidationDecorations.of(Decoration.none) });
          return;
        }

        const cwd = getCurrentDirectory() ?? "/";

        const results = await Promise.all(
          tokens.map(async (token) => {
            try {
              const valid =
                token.type === "command"
                  ? await checkCommandExists(token.value)
                  : await checkPathExists(token.value, cwd);
              return { ...token, valid };
            } catch (error) {
              console.error("Shell validation failed", {
                token,
                cwd,
                error,
              });
              return { ...token, valid: true };
            }
          })
        );

        // Discard stale results if the document changed while we were waiting
        if (view.state.doc.toString() !== text) return;

        const invalid = results.filter((r) => !r.valid).sort((a, b) => a.from - b.from);

        if (invalid.length === 0) {
          view.dispatch({ effects: setValidationDecorations.of(Decoration.none) });
          return;
        }

        const builder = new RangeSetBuilder<Decoration>();
        const errorMark = Decoration.mark({ class: "cm-error-token" });
        for (const r of invalid) {
          builder.add(r.from, r.to, errorMark);
        }

        view.dispatch({ effects: setValidationDecorations.of(builder.finish()) });
      }
    }
  );
}

/**
 * Returns a CodeMirror extension array that asynchronously validates command
 * and path tokens in the editor, decorating invalid tokens with a red error style.
 *
 * @param checkCommandExists  Async function; resolves true when the command exists in PATH / builtins.
 * @param checkPathExists     Async function; resolves true when the path exists on disk.
 * @param getCurrentDirectory Getter for the current working directory (used for relative paths).
 */
export function shellValidation(
  checkCommandExists: CheckCommandExists,
  checkPathExists: CheckPathExists,
  getCurrentDirectory: () => string | null
) {
  return [
    validationField,
    createValidationPlugin(checkCommandExists, checkPathExists, getCurrentDirectory),
  ];
}
