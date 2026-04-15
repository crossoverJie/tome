import type { AiAgentKind } from "../utils/fullscreenSessionState";

interface AgentLogoBadgeProps {
  aiAgentKind: AiAgentKind;
  isFocused: boolean;
  isFullscreenTerminalActive: boolean;
}

// Agent logo asset mapping
export const AGENT_LOGO_ASSETS: Record<NonNullable<AiAgentKind>, { src: string; label: string }> = {
  claude: { src: "/claude.png", label: "Claude" },
  codex: { src: "/codex.png", label: "Codex" },
  opencode: { src: "/opencode.svg", label: "OpenCode" },
  copilot: { src: "/copilot.png", label: "Copilot" },
};

export function getAgentLogoAsset(kind: AiAgentKind): { src: string; label: string } | null {
  if (!kind) return null;
  return AGENT_LOGO_ASSETS[kind] ?? null;
}

export function getAgentLogoLabel(kind: AiAgentKind): string | null {
  return getAgentLogoAsset(kind)?.label ?? null;
}

export function AgentLogoBadge({
  aiAgentKind,
  isFocused,
  isFullscreenTerminalActive,
}: AgentLogoBadgeProps) {
  const asset = getAgentLogoAsset(aiAgentKind);

  // Only show when fullscreen terminal is active and there's an agent kind
  if (!isFullscreenTerminalActive || !asset) return null;

  return (
    <div
      className={`agent-logo-badge ${isFocused ? "focused" : ""}`}
      aria-label={asset.label}
      title={asset.label}
    >
      <img src={asset.src} alt={asset.label} className="agent-logo-img" />
    </div>
  );
}
