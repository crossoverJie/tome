import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Shell 语法高亮样式定义
 * 使用 CSS 变量以便与主题系统集成
 */
export const shellHighlightStyle = HighlightStyle.define([
  // 命令名 - 粉色
  { tag: tags.variableName, color: "var(--syntax-command, #ff79c6)" },

  // 参数/选项 - 青色
  { tag: tags.attributeName, color: "var(--syntax-argument, #8be9fd)" },

  // 路径 - 黄色
  { tag: tags.typeName, color: "var(--syntax-path, #f1fa8c)" },

  // 字符串 - 绿色
  { tag: tags.string, color: "var(--syntax-string, #50fa7b)" },

  // 变量 - 紫色
  { tag: tags.labelName, color: "var(--syntax-variable, #bd93f9)" },

  // 操作符 - 粉色
  { tag: tags.operator, color: "var(--syntax-operator, #ff79c6)" },

  // 注释 - 蓝灰色
  { tag: tags.comment, color: "var(--syntax-comment, #6272a4)" },

  // 关键字 - 粉色
  { tag: tags.keyword, color: "var(--syntax-keyword, #ff79c6)" },

  // 数字 - 橙色（与路径区分开）
  { tag: tags.number, color: "var(--syntax-number, #ffb86c)" },
]);

/**
 * CodeMirror 语法高亮扩展
 */
export const shellSyntaxHighlighting = syntaxHighlighting(shellHighlightStyle);
