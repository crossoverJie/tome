const DIAGNOSTICS_STORAGE_KEY = "tome.debug.lifecycle";
const MAX_DIAGNOSTIC_ENTRIES = 300;

export interface DiagnosticEntry {
  timestamp: string;
  source: string;
  event: string;
  payload: Record<string, unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var __TOME_FORCE_DIAGNOSTICS__: boolean | undefined;
}

interface DiagnosticsWindow extends Window {
  __TOME_DIAGNOSTICS__?: DiagnosticEntry[];
}

function readDiagnosticsPreference(): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
    if (stored === "1") {
      return true;
    }
    if (stored === "0") {
      return false;
    }
  } catch {
    return null;
  }

  return null;
}

export function isDiagnosticsEnabled(): boolean {
  if (globalThis.__TOME_FORCE_DIAGNOSTICS__ === true) {
    return true;
  }
  if (globalThis.__TOME_FORCE_DIAGNOSTICS__ === false) {
    return false;
  }

  const storedPreference = readDiagnosticsPreference();
  if (storedPreference !== null) {
    return storedPreference;
  }

  return Boolean(import.meta.env.DEV) && import.meta.env.MODE !== "test";
}

function describeElement(element: Element | null): string | null {
  if (!element) {
    return null;
  }

  const htmlElement = element as HTMLElement;
  const id = htmlElement.id ? `#${htmlElement.id}` : "";
  const className =
    typeof htmlElement.className === "string" && htmlElement.className.trim().length > 0
      ? `.${htmlElement.className.trim().replace(/\s+/g, ".")}`
      : "";
  return `${element.tagName.toLowerCase()}${id}${className}`;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth >= 2) {
    return "[truncated]";
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? null,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeValue(item, depth + 1));
  }

  if (valueType === "object") {
    const record: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>).slice(
      0,
      20
    )) {
      record[key] = sanitizeValue(nestedValue, depth + 1);
    }
    return record;
  }

  return String(value);
}

export function getRootDiagnosticsSnapshot(): Record<string, unknown> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      rootPresent: false,
      bodyChildCount: 0,
      visibilityState: "unknown",
    };
  }

  const root = document.getElementById("root");
  return {
    rootPresent: Boolean(root),
    rootChildCount: root?.childElementCount ?? 0,
    bodyChildCount: document.body.childElementCount,
    visibilityState: document.visibilityState,
    hasDocumentFocus: document.hasFocus(),
    activeElement: describeElement(document.activeElement),
    windowInnerWidth: window.innerWidth,
    windowInnerHeight: window.innerHeight,
  };
}

export function logDiagnostics(
  source: string,
  event: string,
  payload: Record<string, unknown> = {}
): void {
  if (!isDiagnosticsEnabled()) {
    return;
  }

  try {
    const entry: DiagnosticEntry = {
      timestamp: new Date().toISOString(),
      source,
      event,
      payload: sanitizeValue(payload) as Record<string, unknown>,
    };
    const diagnosticsWindow = window as DiagnosticsWindow;
    const entries = diagnosticsWindow.__TOME_DIAGNOSTICS__ ?? [];
    entries.push(entry);
    if (entries.length > MAX_DIAGNOSTIC_ENTRIES) {
      entries.splice(0, entries.length - MAX_DIAGNOSTIC_ENTRIES);
    }
    diagnosticsWindow.__TOME_DIAGNOSTICS__ = entries;
    console.info("[tome:diagnostics]", entry);
  } catch (error) {
    console.warn("[tome:diagnostics] failed to record entry", error);
  }
}

export function clearDiagnosticsForTest() {
  delete (window as DiagnosticsWindow).__TOME_DIAGNOSTICS__;
  delete globalThis.__TOME_FORCE_DIAGNOSTICS__;
}

export function getDiagnosticsEntriesForTest(): DiagnosticEntry[] {
  return [...((window as DiagnosticsWindow).__TOME_DIAGNOSTICS__ ?? [])];
}
