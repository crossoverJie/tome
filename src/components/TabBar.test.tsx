import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "./TabBar";
import type { Tab } from "../types/tab";
import { createTab } from "../types/tab";

function makeTabs(count: number): Tab[] {
  return Array.from({ length: count }, (_, i) => createTab(`tab-${i + 1}`, `pane-${i + 1}`));
}

describe("TabBar", () => {
  it("does not render when there is only one tab", () => {
    const { container } = render(
      <TabBar
        tabs={makeTabs(1)}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
      />
    );
    expect(container.querySelector(".tab-bar")).toBeNull();
  });

  it("renders tab items when there are multiple tabs", () => {
    render(
      <TabBar
        tabs={makeTabs(3)}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
      />
    );
    const items = screen.getAllByText(/Shell/);
    expect(items.length).toBe(3);
  });

  it("marks the active tab with the active class", () => {
    const { container } = render(
      <TabBar
        tabs={makeTabs(2)}
        activeTabId="tab-2"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
      />
    );
    const tabItems = container.querySelectorAll(".tab-item");
    expect(tabItems[0].classList.contains("active")).toBe(false);
    expect(tabItems[1].classList.contains("active")).toBe(true);
  });

  it("calls onSwitchTab when a tab is clicked", () => {
    const onSwitchTab = vi.fn();
    const { container } = render(
      <TabBar
        tabs={makeTabs(2)}
        activeTabId="tab-1"
        onSwitchTab={onSwitchTab}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
      />
    );
    const tabItems = container.querySelectorAll(".tab-item");
    fireEvent.click(tabItems[1]);
    expect(onSwitchTab).toHaveBeenCalledWith("tab-2");
  });

  it("calls onCloseTab when close button is clicked", () => {
    const onCloseTab = vi.fn();
    const { container } = render(
      <TabBar
        tabs={makeTabs(2)}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={onCloseTab}
      />
    );
    const closeButtons = container.querySelectorAll(".tab-close");
    fireEvent.click(closeButtons[0]);
    expect(onCloseTab).toHaveBeenCalledWith("tab-1");
  });

  it("calls onCreateTab when the + button is clicked", () => {
    const onCreateTab = vi.fn();
    render(
      <TabBar
        tabs={makeTabs(2)}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={onCreateTab}
        onCloseTab={() => {}}
      />
    );
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(onCreateTab).toHaveBeenCalledOnce();
  });
});
