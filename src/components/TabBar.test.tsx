import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "./TabBar";
import type { Tab } from "../types/tab";
import { createTab } from "../types/tab";
import type { TabPresentation } from "../utils/agentStatus";

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

  it("renders custom labels from tabPresentations", () => {
    const tabs = makeTabs(2);
    const tabPresentations = new Map<string, TabPresentation>([
      ["tab-1", { label: "tome · cc", tooltip: "/home/user/tome\nRunning: Claude" }],
      ["tab-2", { label: "api · cx", tooltip: "/home/user/api\nRunning: Codex" }],
    ]);

    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
        tabPresentations={tabPresentations}
      />
    );

    expect(screen.getByText("tome · cc")).toBeTruthy();
    expect(screen.getByText("api · cx")).toBeTruthy();
  });

  it("sets tooltip from tabPresentations", () => {
    const tabs = makeTabs(2);
    const tabPresentations = new Map<string, TabPresentation>([
      ["tab-1", { label: "tome · cc", tooltip: "/home/user/tome\nRunning: Claude" }],
      ["tab-2", { label: "api", tooltip: "/home/user/api" }],
    ]);

    const { container } = render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
        tabPresentations={tabPresentations}
      />
    );

    const tabItems = container.querySelectorAll(".tab-item");
    expect(tabItems[0].getAttribute("title")).toBe("/home/user/tome\nRunning: Claude");
    expect(tabItems[1].getAttribute("title")).toBe("/home/user/api");
  });

  it("falls back to tab.title when tabPresentations is not provided", () => {
    const tabs = [
      { ...createTab("tab-1", "pane-1"), title: "Custom Title 1" },
      { ...createTab("tab-2", "pane-2"), title: "Custom Title 2" },
    ];

    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
      />
    );

    expect(screen.getByText("Custom Title 1")).toBeTruthy();
    expect(screen.getByText("Custom Title 2")).toBeTruthy();
  });

  it("falls back to tab.title when tabPresentations entry is missing", () => {
    const tabs = [
      { ...createTab("tab-1", "pane-1"), title: "Custom Title 1" },
      { ...createTab("tab-2", "pane-2"), title: "Custom Title 2" },
    ];
    const tabPresentations = new Map<string, TabPresentation>();

    render(
      <TabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitchTab={() => {}}
        onCreateTab={() => {}}
        onCloseTab={() => {}}
        tabPresentations={tabPresentations}
      />
    );

    expect(screen.getByText("Custom Title 1")).toBeTruthy();
    expect(screen.getByText("Custom Title 2")).toBeTruthy();
  });
});
