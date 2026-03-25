import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "./Settings";

describe("Settings", () => {
  it("renders the settings panel with placeholder text", () => {
    render(<Settings onClose={() => {}} />);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Settings coming soon.")).toBeTruthy();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} />);
    fireEvent.click(screen.getByText("Esc"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<Settings onClose={onClose} />);
    fireEvent.click(container.querySelector(".settings-overlay")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when panel content is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<Settings onClose={onClose} />);
    fireEvent.click(container.querySelector(".settings-panel")!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
