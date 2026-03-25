import { useEffect, useCallback } from "react";
import { BlockList } from "./components/BlockList";
import { InputEditor } from "./components/InputEditor";
import { FullscreenTerminal } from "./components/FullscreenTerminal";
import { useTerminalSession } from "./hooks/useTerminalSession";
import "./App.css";

function App() {
  const {
    blocks,
    isAlternateScreen,
    rawOutput,
    sendInput,
    resizePty,
    clearBlocks,
    selectedBlockIndex,
    selectBlock,
    selectPrevBlock,
    selectNextBlock,
  } = useTerminalSession();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        clearBlocks();
      }
      if (e.metaKey && e.key === "ArrowUp") {
        e.preventDefault();
        selectPrevBlock();
      }
      if (e.metaKey && e.key === "ArrowDown") {
        e.preventDefault();
        selectNextBlock();
      }
      if (e.metaKey && e.shiftKey && e.key === "C") {
        e.preventDefault();
        if (selectedBlockIndex !== null && blocks[selectedBlockIndex]) {
          navigator.clipboard.writeText(blocks[selectedBlockIndex].output);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearBlocks, selectPrevBlock, selectNextBlock, selectedBlockIndex, blocks]);

  const handleSubmit = useCallback(
    (command: string) => {
      selectBlock(null);
      sendInput(command);
    },
    [sendInput, selectBlock]
  );

  return (
    <div className="app">
      {!isAlternateScreen && (
        <>
          <BlockList
            blocks={blocks}
            selectedBlockIndex={selectedBlockIndex}
            onSelectBlock={selectBlock}
          />
          <InputEditor onSubmit={handleSubmit} disabled={isAlternateScreen} />
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

export default App;
