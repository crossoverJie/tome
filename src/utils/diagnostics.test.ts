import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiagnosticsForTest,
  getDiagnosticsEntriesForTest,
  isDiagnosticsConsoleEnabled,
  isDiagnosticsEnabled,
  logDiagnostics,
} from "./diagnostics";

describe("diagnostics", () => {
  beforeEach(() => {
    clearDiagnosticsForTest();
    vi.restoreAllMocks();
  });

  it("does not emit entries when diagnostics are disabled", () => {
    globalThis.__TOME_FORCE_DIAGNOSTICS__ = false;

    logDiagnostics("test-source", "disabled-event", { ok: true });

    expect(isDiagnosticsEnabled()).toBe(false);
    expect(getDiagnosticsEntriesForTest()).toEqual([]);
  });

  it("emits structured entries when diagnostics are enabled", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    globalThis.__TOME_FORCE_DIAGNOSTICS__ = true;

    logDiagnostics("test-source", "enabled-event", {
      nested: { value: "kept" },
      list: ["a", "b"],
    });

    expect(isDiagnosticsEnabled()).toBe(true);
    expect(getDiagnosticsEntriesForTest()).toEqual([
      expect.objectContaining({
        source: "test-source",
        event: "enabled-event",
        payload: expect.objectContaining({
          nested: expect.any(Object),
          list: expect.any(Array),
        }),
      }),
    ]);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(isDiagnosticsConsoleEnabled()).toBe(false);
  });

  it("mirrors diagnostics to the console only when explicitly enabled", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    globalThis.__TOME_FORCE_DIAGNOSTICS__ = true;
    globalThis.__TOME_FORCE_DIAGNOSTICS_CONSOLE__ = true;

    logDiagnostics("test-source", "console-event", { ok: true });

    expect(isDiagnosticsConsoleEnabled()).toBe(true);
    expect(infoSpy).toHaveBeenCalledOnce();
  });
});
