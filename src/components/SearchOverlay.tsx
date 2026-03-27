import { useEffect, useRef, useCallback } from "react";

interface SearchOverlayProps {
  query: string;
  resultCount: number;
  currentIndex: number;
  isOpen: boolean;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchOverlay({
  query,
  resultCount,
  currentIndex,
  isOpen,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: SearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          onPrev();
        } else {
          onNext();
        }
        return;
      }
    },
    [onClose, onNext, onPrev]
  );

  if (!isOpen) return null;

  const displayText = resultCount > 0 ? `${currentIndex + 1}/${resultCount}` : "0/0";

  return (
    <div className="search-overlay" onKeyDown={handleKeyDown}>
      <div className="search-container">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search blocks..."
          spellCheck={false}
        />
        <span className="search-count">{displayText}</span>
        <button
          className="search-nav-btn"
          onClick={onPrev}
          disabled={resultCount === 0}
          title="Previous match (Shift+Enter)"
        >
          ▲
        </button>
        <button
          className="search-nav-btn"
          onClick={onNext}
          disabled={resultCount === 0}
          title="Next match (Enter)"
        >
          ▼
        </button>
        <button className="search-close-btn" onClick={onClose} title="Close (Escape)">
          ✕
        </button>
      </div>
    </div>
  );
}
