import { StreamLanguage } from "@codemirror/language";
import type { StreamParser, StringStream } from "@codemirror/language";

// Shell 关键字
const shellKeywords = new Set([
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

interface ShellState {
  expectCommand: boolean;
}

const shellParser: StreamParser<ShellState> = {
  startState(): ShellState {
    return { expectCommand: true };
  },

  token(stream: StringStream, state: ShellState): string | null {
    // 跳过空白
    if (stream.eatSpace()) {
      return null;
    }

    // 行首注释
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }

    // 字符串：双引号
    if (stream.match('"')) {
      state.expectCommand = false;
      while (!stream.eol()) {
        if (stream.match('"')) return "string";
        if (stream.match('\\"', false) || stream.match("\\\\", false)) {
          stream.next();
          stream.next();
        } else {
          stream.next();
        }
      }
      return "string";
    }

    // 字符串：单引号
    if (stream.match("'")) {
      state.expectCommand = false;
      while (!stream.eol()) {
        if (stream.match("'")) return "string";
        stream.next();
      }
      return "string";
    }

    // 变量：${VAR}
    if (stream.match("${")) {
      while (!stream.eol() && stream.peek() !== "}") {
        stream.next();
      }
      stream.match("}");
      state.expectCommand = false;
      return "variable";
    }

    // 变量：$VAR 或 $@
    if (stream.match("$")) {
      if (stream.match(/[0-9*@#?$!_]/)) {
        state.expectCommand = false;
        return "variable";
      }
      if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) {
        state.expectCommand = false;
        return "variable";
      }
      return "operator";
    }

    // 操作符
    if (stream.match(/(&&|\|\||<<|>>|<=|>=|==|!=)/)) {
      state.expectCommand = false;
      return "operator";
    }

    // 单个字符操作符
    const ch = stream.peek();
    if (ch && /[|&;<>()\[\]{}]/.test(ch)) {
      stream.next();
      // 管道符、分号后期待命令
      if (ch === "|" || ch === ";" || ch === "&" || ch === "(") {
        state.expectCommand = true;
      } else {
        state.expectCommand = false;
      }
      return "operator";
    }

    // 参数：-- 或 -
    if (stream.match(/^--[a-zA-Z][-a-zA-Z0-9]*/)) {
      state.expectCommand = false;
      return "attribute";
    }
    if (stream.match(/^-[a-zA-Z0-9]+/)) {
      state.expectCommand = false;
      return "attribute";
    }

    // 数字
    if (stream.match(/^[0-9]+/)) {
      state.expectCommand = false;
      return "number";
    }

    // 单词
    const matchResult = stream.match(/^[^\s\$"'|&;<>()\[\]{}#]+/);
    if (matchResult && matchResult !== true) {
      const wordStr = matchResult[0];

      // 如果期待命令
      if (state.expectCommand) {
        state.expectCommand = false;
        if (shellKeywords.has(wordStr)) {
          return "keyword";
        }
        return "variableName"; // 用于命令高亮
      }

      // 路径检测（包含 / 或以 . 开头）
      if (wordStr.includes("/") || wordStr.startsWith(".")) {
        return "typeName"; // 用于路径高亮
      }

      return null; // 普通参数，无特殊高亮
    }

    // 默认情况
    stream.next();
    state.expectCommand = false;
    return null;
  },

  blankLine(state: ShellState) {
    state.expectCommand = true;
  },
};

export const shellLanguage = StreamLanguage.define(shellParser);
