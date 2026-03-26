import type { CompletionResponse, CompletionItem } from "../types/completion";

export type CompletionDecision =
  | { kind: "noop" }
  | { kind: "apply"; value: string; replaceFrom: number; replaceTo: number }
  | {
      kind: "open";
      items: CompletionItem[];
      replaceFrom: number;
      replaceTo: number;
    };

export interface AppliedCompletion {
  text: string;
  cursor: number;
}

export function applyCompletionValue(
  text: string,
  replaceFrom: number,
  replaceTo: number,
  value: string
): AppliedCompletion {
  const nextText = `${text.slice(0, replaceFrom)}${value}${text.slice(replaceTo)}`;

  return {
    text: nextText,
    cursor: replaceFrom + value.length,
  };
}

export function decideCompletionAction(
  response: CompletionResponse,
  text: string,
  cursor: number
): CompletionDecision {
  if (response.items.length === 0) {
    return { kind: "noop" };
  }

  if (response.items.length === 1) {
    return {
      kind: "apply",
      value: response.items[0].value,
      replaceFrom: response.replaceFrom,
      replaceTo: response.replaceTo,
    };
  }

  const currentPrefix = text.slice(response.replaceFrom, cursor);

  if (response.commonPrefix && response.commonPrefix.length > currentPrefix.length) {
    return {
      kind: "apply",
      value: response.commonPrefix,
      replaceFrom: response.replaceFrom,
      replaceTo: response.replaceTo,
    };
  }

  return {
    kind: "open",
    items: response.items,
    replaceFrom: response.replaceFrom,
    replaceTo: response.replaceTo,
  };
}

export function cycleCompletionIndex(current: number, delta: number, length: number): number {
  if (length === 0) {
    return 0;
  }

  return (current + delta + length) % length;
}
