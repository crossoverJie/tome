import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiagnosticsForTest,
  getDiagnosticsEntriesForTest,
  logDiagnostics,
  isDiagnosticsEnabled,
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
    expect(infoSpy).toHaveBeenCalledOnce();
  });
});
