export type OutputLinkKind = "url" | "path";

export interface OutputLinkMatch {
  kind: OutputLinkKind;
  text: string;
  target: string;
  start: number;
  end: number;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const PATH_PATTERN =
  /(?:~\/[^\s<>"'`]+|\.{1,2}\/[^\s<>"'`]+|\/[^\s<>"'`]+|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?::\d+(?::\d+)?)?)/g;
const TRAILING_PUNCTUATION = /[),.;!?]+$/;
const LEADING_PUNCTUATION = /^[([{"'`]+/;
const FILE_LOCATION_SUFFIX = /:\d+(?::\d+)?$/;

function trimCandidate(candidate: string): {
  text: string;
  leadingTrim: number;
  trailingTrim: number;
} {
  const leading = candidate.match(LEADING_PUNCTUATION)?.[0].length ?? 0;
  const trailing = candidate.match(TRAILING_PUNCTUATION)?.[0].length ?? 0;
  const text = candidate.slice(leading, candidate.length - trailing);
  return { text, leadingTrim: leading, trailingTrim: trailing };
}

function normalizePathTarget(text: string): string {
  return text.replace(FILE_LOCATION_SUFFIX, "");
}

function addMatches(
  text: string,
  pattern: RegExp,
  kind: OutputLinkKind,
  matches: OutputLinkMatch[]
) {
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const trimmed = trimCandidate(raw);
    if (!trimmed.text) {
      continue;
    }

    const start = index + trimmed.leadingTrim;
    const end = start + trimmed.text.length;
    const target = kind === "path" ? normalizePathTarget(trimmed.text) : trimmed.text;

    matches.push({
      kind,
      text: trimmed.text,
      target,
      start,
      end,
    });
  }
}

export function findOutputLinks(text: string): OutputLinkMatch[] {
  const matches: OutputLinkMatch[] = [];
  addMatches(text, URL_PATTERN, "url", matches);
  addMatches(text, PATH_PATTERN, "path", matches);

  return matches
    .sort((a, b) => {
      if (a.start === b.start) {
        return b.end - a.end;
      }
      return a.start - b.start;
    })
    .filter((match, index, sorted) => {
      const previous = sorted[index - 1];
      return !previous || match.start >= previous.end;
    });
}

function createOutputLinkNode(match: OutputLinkMatch): HTMLSpanElement {
  const node = document.createElement("span");
  node.textContent = match.text;
  node.className = `output-link output-link-${match.kind}`;
  node.dataset.outputLinkKind = match.kind;
  node.dataset.outputLinkTarget = match.target;
  node.dataset.outputLinkText = match.text;
  node.title = match.kind === "url" ? "Cmd+Click to open in browser" : "Click to open in Tome";
  return node;
}

export function linkifyOutputElement(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent) {
      textNodes.push(currentNode as Text);
    }
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const matches = findOutputLinks(text);
    if (matches.length === 0) {
      continue;
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const match of matches) {
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      }
      fragment.appendChild(createOutputLinkNode(match));
      cursor = match.end;
    }

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}
