import { describe, it, expect } from "vitest";
import {
  AGENT_TOKENS,
  AGENT_LABELS,
  getAgentToken,
  getAgentLabel,
  sortAgents,
  formatAgentLabel,
  buildAgentTooltip,
  aggregateTabAgentSummary,
  createTabPresentation,
  type PaneAgentState,
  type TabAgentSummary,
} from "./agentStatus";
import type { AiAgentKind } from "./fullscreenSessionState";
import type { Tab } from "../types/tab";
import { createTab } from "../types/tab";

describe("AGENT_TOKENS", () => {
  it("maps agent kinds to two-letter tokens", () => {
    expect(AGENT_TOKENS.claude).toBe("cc");
    expect(AGENT_TOKENS.codex).toBe("cx");
    expect(AGENT_TOKENS.opencode).toBe("op");
    expect(AGENT_TOKENS.copilot).toBe("cp");
  });
});

describe("AGENT_LABELS", () => {
  it("maps agent kinds to full labels", () => {
    expect(AGENT_LABELS.claude).toBe("Claude");
    expect(AGENT_LABELS.codex).toBe("Codex");
    expect(AGENT_LABELS.opencode).toBe("OpenCode");
    expect(AGENT_LABELS.copilot).toBe("Copilot");
  });
});

describe("getAgentToken", () => {
  it("returns correct token for each agent kind", () => {
    expect(getAgentToken("claude")).toBe("cc");
    expect(getAgentToken("codex")).toBe("cx");
    expect(getAgentToken("opencode")).toBe("op");
    expect(getAgentToken("copilot")).toBe("cp");
  });
});

describe("getAgentLabel", () => {
  it("returns correct label for each agent kind", () => {
    expect(getAgentLabel("claude")).toBe("Claude");
    expect(getAgentLabel("codex")).toBe("Codex");
    expect(getAgentLabel("opencode")).toBe("OpenCode");
    expect(getAgentLabel("copilot")).toBe("Copilot");
  });
});

describe("sortAgents", () => {
  it("sorts agents in stable order: cc, cx, op, cp", () => {
    const input: Exclude<AiAgentKind, null>[] = ["copilot", "claude", "opencode", "codex"];
    const sorted = sortAgents(input);
    expect(sorted).toEqual(["claude", "codex", "opencode", "copilot"]);
  });

  it("handles empty array", () => {
    expect(sortAgents([])).toEqual([]);
  });

  it("handles single agent", () => {
    expect(sortAgents(["opencode"])).toEqual(["opencode"]);
  });
});

describe("formatAgentLabel", () => {
  it("returns directory name only when no agents", () => {
    expect(formatAgentLabel("tome", [])).toBe("tome");
  });

  it("formats single agent with dot separator", () => {
    expect(formatAgentLabel("tome", ["claude"])).toBe("tome · cc");
  });

  it("formats two agents with plus separator", () => {
    expect(formatAgentLabel("tome", ["claude", "codex"])).toBe("tome · cc+cx");
  });

  it("sorts agents before formatting", () => {
    expect(formatAgentLabel("tome", ["copilot", "claude"])).toBe("tome · cc+cp");
  });

  it("formats three agents with first two and count", () => {
    expect(formatAgentLabel("tome", ["claude", "codex", "opencode"])).toBe("tome · cc+cx+1");
  });

  it("formats four agents with first two and count", () => {
    expect(formatAgentLabel("tome", ["claude", "codex", "opencode", "copilot"])).toBe(
      "tome · cc+cx+2"
    );
  });
});

describe("buildAgentTooltip", () => {
  it("returns path only when no agents", () => {
    const summary: TabAgentSummary = { agents: [], activePaneCount: 0, totalAgentCount: 0 };
    expect(buildAgentTooltip("/home/user/tome", summary)).toBe("/home/user/tome");
  });

  it("returns Shell when path is null", () => {
    const summary: TabAgentSummary = { agents: [], activePaneCount: 0, totalAgentCount: 0 };
    expect(buildAgentTooltip(null, summary)).toBe("Shell");
  });

  it("shows single agent in tooltip", () => {
    const summary: TabAgentSummary = {
      agents: ["claude"],
      activePaneCount: 1,
      totalAgentCount: 1,
    };
    expect(buildAgentTooltip("/home/user/tome", summary)).toBe("/home/user/tome\nRunning: Claude");
  });

  it("shows multiple agents in tooltip with pane count", () => {
    const summary: TabAgentSummary = {
      agents: ["claude", "codex"],
      activePaneCount: 2,
      totalAgentCount: 2,
    };
    expect(buildAgentTooltip("/home/user/tome", summary)).toBe(
      "/home/user/tome\nRunning in 2 panes: Claude, Codex"
    );
  });

  it("sorts agents in tooltip", () => {
    const summary: TabAgentSummary = {
      agents: ["copilot", "claude"],
      activePaneCount: 2,
      totalAgentCount: 2,
    };
    expect(buildAgentTooltip("/home/user/tome", summary)).toBe(
      "/home/user/tome\nRunning in 2 panes: Claude, Copilot"
    );
  });
});

describe("aggregateTabAgentSummary", () => {
  it("returns empty summary for tab with no agents", () => {
    const tab = createTab("tab-1", "pane-1");
    const paneAgentMap = new Map<string, PaneAgentState>();

    const summary = aggregateTabAgentSummary(tab, paneAgentMap);

    expect(summary.agents).toEqual([]);
    expect(summary.activePaneCount).toBe(0);
    expect(summary.totalAgentCount).toBe(0);
  });

  it("aggregates single agent from single pane", () => {
    const tab = createTab("tab-1", "pane-1");
    const paneAgentMap = new Map<string, PaneAgentState>([
      ["pane-1", { aiAgentKind: "claude", isActive: true }],
    ]);

    const summary = aggregateTabAgentSummary(tab, paneAgentMap);

    expect(summary.agents).toEqual(["claude"]);
    expect(summary.activePaneCount).toBe(1);
    expect(summary.totalAgentCount).toBe(1);
  });

  it("deduplicates same agent across multiple panes", () => {
    // Create tab with split pane containing two leaves
    const tab: Tab = {
      id: "tab-1",
      title: "Test",
      rootPaneId: "split-1",
      panes: new Map([
        [
          "split-1",
          {
            type: "split",
            id: "split-1",
            direction: "horizontal",
            children: ["pane-1", "pane-2"],
            splitRatio: 0.5,
          },
        ],
        ["pane-1", { type: "leaf", id: "pane-1", sessionId: "session-1" }],
        ["pane-2", { type: "leaf", id: "pane-2", sessionId: "session-2" }],
      ]),
      focusedPaneId: "pane-1",
    };

    const paneAgentMap = new Map<string, PaneAgentState>([
      ["pane-1", { aiAgentKind: "claude", isActive: true }],
      ["pane-2", { aiAgentKind: "claude", isActive: true }],
    ]);

    const summary = aggregateTabAgentSummary(tab, paneAgentMap);

    expect(summary.agents).toEqual(["claude"]);
    expect(summary.activePaneCount).toBe(2);
    expect(summary.totalAgentCount).toBe(2);
  });

  it("aggregates different agents across multiple panes", () => {
    const tab: Tab = {
      id: "tab-1",
      title: "Test",
      rootPaneId: "split-1",
      panes: new Map([
        [
          "split-1",
          {
            type: "split",
            id: "split-1",
            direction: "horizontal",
            children: ["pane-1", "pane-2"],
            splitRatio: 0.5,
          },
        ],
        ["pane-1", { type: "leaf", id: "pane-1", sessionId: "session-1" }],
        ["pane-2", { type: "leaf", id: "pane-2", sessionId: "session-2" }],
      ]),
      focusedPaneId: "pane-1",
    };

    const paneAgentMap = new Map<string, PaneAgentState>([
      ["pane-1", { aiAgentKind: "claude", isActive: true }],
      ["pane-2", { aiAgentKind: "codex", isActive: true }],
    ]);

    const summary = aggregateTabAgentSummary(tab, paneAgentMap);

    expect(summary.agents).toEqual(["claude", "codex"]);
    expect(summary.activePaneCount).toBe(2);
    expect(summary.totalAgentCount).toBe(2);
  });

  it("ignores inactive agents", () => {
    const tab = createTab("tab-1", "pane-1");
    const paneAgentMap = new Map<string, PaneAgentState>([
      ["pane-1", { aiAgentKind: "claude", isActive: false }],
    ]);

    const summary = aggregateTabAgentSummary(tab, paneAgentMap);

    expect(summary.agents).toEqual([]);
    expect(summary.activePaneCount).toBe(0);
    expect(summary.totalAgentCount).toBe(0);
  });

  it("ignores null aiAgentKind", () => {
    const tab = createTab("tab-1", "pane-1");
    const paneAgentMap = new Map<string, PaneAgentState>([
      ["pane-1", { aiAgentKind: null, isActive: true }],
    ]);

    const summary = aggregateTabAgentSummary(tab, paneAgentMap);

    expect(summary.agents).toEqual([]);
    expect(summary.activePaneCount).toBe(0);
    expect(summary.totalAgentCount).toBe(0);
  });
});

describe("createTabPresentation", () => {
  it("creates presentation without agents", () => {
    const summary: TabAgentSummary = { agents: [], activePaneCount: 0, totalAgentCount: 0 };
    const presentation = createTabPresentation("tome", "/home/user/tome", summary);

    expect(presentation.label).toBe("tome");
    expect(presentation.tooltip).toBe("/home/user/tome");
  });

  it("creates presentation with single agent", () => {
    const summary: TabAgentSummary = {
      agents: ["claude"],
      activePaneCount: 1,
      totalAgentCount: 1,
    };
    const presentation = createTabPresentation("tome", "/home/user/tome", summary);

    expect(presentation.label).toBe("tome · cc");
    expect(presentation.tooltip).toBe("/home/user/tome\nRunning: Claude");
  });

  it("creates presentation with multiple agents", () => {
    const summary: TabAgentSummary = {
      agents: ["claude", "codex"],
      activePaneCount: 2,
      totalAgentCount: 2,
    };
    const presentation = createTabPresentation("tome", "/home/user/tome", summary);

    expect(presentation.label).toBe("tome · cc+cx");
    expect(presentation.tooltip).toBe("/home/user/tome\nRunning in 2 panes: Claude, Codex");
  });
});
