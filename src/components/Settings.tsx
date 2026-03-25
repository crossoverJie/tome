import { memo } from "react";

interface SettingsProps {
  onClose: () => void;
}

export const Settings = memo(function Settings({ onClose }: SettingsProps) {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            Esc
          </button>
        </div>
        <div className="settings-body">
          <p className="settings-placeholder">Settings coming soon.</p>
          <p className="settings-hint">Theme, font, keybindings and more will be available here.</p>
        </div>
      </div>
    </div>
  );
});
