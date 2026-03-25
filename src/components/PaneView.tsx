import { useEffect, useCallback } from "react";
import { BlockList } from "./BlockList";
import { InputEditor } from "./InputEditor";
import { FullscreenTerminal } from "./FullscreenTerminal";
import { useTerminalSession } from "../hooks/useTerminalSession";

interface PaneViewProps {
  paneId: string;
  sessionId?: string;
  isFocused: boolean;
  onFocus: () => void;
}

export function PaneView({ paneId, sessionId, isFocused, onFocus }: PaneViewProps) {
  const {
    blocks,
    isAlternateScreen,
    rawOutput,
    sendInput,
    resizePty,
    selectedBlockIndex,
    selectBlock,
  } = useTerminalSession(paneId, sessionId);

  // Resize PTY when pane size changes
  // We use a ResizeObserver in the parent, but here we handle initial size
  useEffect(() => {
    // Default size - actual resize happens via container ref
    resizePty(80, 24);
  }, [resizePty]);

  const handleSubmit = useCallback(
    (command: string) => {
      selectBlock(null);
      sendInput(command);
    },
    [sendInput, selectBlock]
  );

  // Handle pane focus when clicked
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't focus if clicking on interactive elements
      const target = e.target as HTMLElement;
      if (target.closest(".input-editor-container") || target.closest(".block-output")) {
        onFocus();
        return;
      }
      onFocus();
    },
    [onFocus]
  );

  return (
    <div className={`pane-view ${isFocused ? "focused" : ""}`} onClick={handleClick}>
      {!isAlternateScreen && (
        <>
          <BlockList
            blocks={blocks}
            selectedBlockIndex={selectedBlockIndex}
            onSelectBlock={selectBlock}
          />
          <InputEditor onSubmit={handleSubmit} disabled={!isFocused || isAlternateScreen} />
        </>
      )}
      <FullscreenTerminal
        visible={isAlternateScreen}
        onData={sendInput}
        onResize={resizePty}
        rawOutput={rawOutput}
      />
    </div>
  );
}
