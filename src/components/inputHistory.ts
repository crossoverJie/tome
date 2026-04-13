export interface InlineHistorySuggestion {
  fullCommand: string;
  suffix: string;
}

export interface HistoryNavigationResult {
  index: number;
  value: string | null;
}

export function getHistoryMatches(history: string[], prefix: string): string[] {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return [];
  }

  const matches: string[] = [];
  const seen = new Set<string>();

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const command = history[index];
    if (!command.startsWith(trimmedPrefix) || seen.has(command)) {
      continue;
    }

    matches.push(command);
    seen.add(command);
  }

  return matches;
}

export function getInlineHistorySuggestion(
  history: string[],
  text: string,
  cursor: number
): InlineHistorySuggestion | null {
  if (cursor !== text.length) {
    return null;
  }

  const match = getHistoryMatches(history, text).find((command) => command !== text);
  if (!match) {
    return null;
  }

  return {
    fullCommand: match,
    suffix: match.slice(text.length),
  };
}

export function navigateHistoryMatches(
  matches: string[],
  currentIndex: number,
  delta: -1 | 1
): HistoryNavigationResult {
  if (matches.length === 0) {
    return { index: -1, value: null };
  }

  if (delta < 0) {
    const nextIndex = Math.min(currentIndex + 1, matches.length - 1);
    return { index: nextIndex, value: matches[nextIndex] };
  }

  const nextIndex = currentIndex - 1;
  if (nextIndex < 0) {
    return { index: -1, value: null };
  }

  return { index: nextIndex, value: matches[nextIndex] };
}
