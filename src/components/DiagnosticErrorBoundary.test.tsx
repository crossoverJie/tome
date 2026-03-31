import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticErrorBoundary } from "./DiagnosticErrorBoundary";
import { clearDiagnosticsForTest, getDiagnosticsEntriesForTest } from "../utils/diagnostics";

function ThrowingChild(): JSX.Element {
  throw new Error("boom");
}

describe("DiagnosticErrorBoundary", () => {
  beforeEach(() => {
    clearDiagnosticsForTest();
    globalThis.__TOME_FORCE_DIAGNOSTICS__ = true;
  });

  it("logs captured render errors and shows a fallback", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    render(
      <DiagnosticErrorBoundary>
        <ThrowingChild />
      </DiagnosticErrorBoundary>
    );

    expect(screen.getByRole("alert").textContent).toContain("Renderer error captured.");
    expect(getDiagnosticsEntriesForTest()).toEqual([
      expect.objectContaining({
        source: "DiagnosticErrorBoundary",
        event: "react-error",
      }),
    ]);

    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
