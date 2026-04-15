import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AgentLogoBadge,
  AGENT_LOGO_ASSETS,
  getAgentLogoAsset,
  getAgentLogoLabel,
} from "./AgentLogoBadge";
import type { AiAgentKind } from "../utils/fullscreenSessionState";

describe("AgentLogoBadge", () => {
  describe("component rendering", () => {
    it("should not render when aiAgentKind is null", () => {
      const { container } = render(
        <AgentLogoBadge aiAgentKind={null} isFocused={false} isFullscreenTerminalActive={true} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("should not render when fullscreen terminal is not active", () => {
      const { container } = render(
        <AgentLogoBadge aiAgentKind="claude" isFocused={false} isFullscreenTerminalActive={false} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("should render claude logo when aiAgentKind is claude and fullscreen is active", () => {
      render(
        <AgentLogoBadge aiAgentKind="claude" isFocused={false} isFullscreenTerminalActive={true} />
      );
      const img = screen.getByAltText("Claude");
      expect(img).toBeDefined();
      expect(img.getAttribute("src")).toBe("/claude.png");
    });

    it("should render codex logo when aiAgentKind is codex", () => {
      render(
        <AgentLogoBadge aiAgentKind="codex" isFocused={false} isFullscreenTerminalActive={true} />
      );
      const img = screen.getByAltText("Codex");
      expect(img).toBeDefined();
      expect(img.getAttribute("src")).toBe("/codex.png");
    });

    it("should render opencode logo when aiAgentKind is opencode", () => {
      render(
        <AgentLogoBadge
          aiAgentKind="opencode"
          isFocused={false}
          isFullscreenTerminalActive={true}
        />
      );
      const img = screen.getByAltText("OpenCode");
      expect(img).toBeDefined();
      expect(img.getAttribute("src")).toBe("/opencode.svg");
    });

    it("should render copilot logo when aiAgentKind is copilot", () => {
      render(
        <AgentLogoBadge aiAgentKind="copilot" isFocused={false} isFullscreenTerminalActive={true} />
      );
      const img = screen.getByAltText("Copilot");
      expect(img).toBeDefined();
      expect(img.getAttribute("src")).toBe("/copilot.png");
    });

    it("should have focused class when isFocused is true", () => {
      render(
        <AgentLogoBadge aiAgentKind="claude" isFocused={true} isFullscreenTerminalActive={true} />
      );
      const badge = screen.getByLabelText("Claude");
      expect(badge.classList.contains("focused")).toBe(true);
    });

    it("should not have focused class when isFocused is false", () => {
      render(
        <AgentLogoBadge aiAgentKind="claude" isFocused={false} isFullscreenTerminalActive={true} />
      );
      const badge = screen.getByLabelText("Claude");
      expect(badge.classList.contains("focused")).toBe(false);
    });
  });

  describe("getAgentLogoAsset", () => {
    it("should return null for null kind", () => {
      expect(getAgentLogoAsset(null)).toBeNull();
    });

    it("should return asset for claude", () => {
      const asset = getAgentLogoAsset("claude");
      expect(asset).toEqual({ src: "/claude.png", label: "Claude" });
    });

    it("should return asset for codex", () => {
      const asset = getAgentLogoAsset("codex");
      expect(asset).toEqual({ src: "/codex.png", label: "Codex" });
    });

    it("should return asset for opencode", () => {
      const asset = getAgentLogoAsset("opencode");
      expect(asset).toEqual({ src: "/opencode.svg", label: "OpenCode" });
    });

    it("should return asset for copilot", () => {
      const asset = getAgentLogoAsset("copilot");
      expect(asset).toEqual({ src: "/copilot.png", label: "Copilot" });
    });
  });

  describe("getAgentLogoLabel", () => {
    it("should return null for null kind", () => {
      expect(getAgentLogoLabel(null)).toBeNull();
    });

    it("should return label for each agent kind", () => {
      expect(getAgentLogoLabel("claude")).toBe("Claude");
      expect(getAgentLogoLabel("codex")).toBe("Codex");
      expect(getAgentLogoLabel("opencode")).toBe("OpenCode");
      expect(getAgentLogoLabel("copilot")).toBe("Copilot");
    });
  });

  describe("AGENT_LOGO_ASSETS", () => {
    it("should contain all supported agent kinds", () => {
      const expectedKinds: NonNullable<AiAgentKind>[] = ["claude", "codex", "opencode", "copilot"];
      expect(Object.keys(AGENT_LOGO_ASSETS).sort()).toEqual(expectedKinds.sort());
    });

    it("each asset should have src and label", () => {
      Object.entries(AGENT_LOGO_ASSETS).forEach(([, asset]) => {
        expect(asset.src).toBeDefined();
        expect(asset.src).toMatch(/^\/.*\.(png|svg)$/);
        expect(asset.label).toBeDefined();
        expect(typeof asset.label).toBe("string");
      });
    });
  });
});
