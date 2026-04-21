# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tome is a lightweight block-based terminal application built with **Tauri 2** (Rust backend + React 19/TypeScript frontend). It renders shell command output as discrete blocks using the OSC 133 shell integration protocol.

## Development Commands

```bash
# Full app (frontend + native shell)
pnpm tauri dev

# Frontend only
pnpm dev                    # Vite dev server on port 1420
pnpm build                  # TypeScript check + Vite production build

# Frontend tests
pnpm test                   # Single run (vitest)
pnpm test:watch             # Watch mode

# Frontend formatting
pnpm format                 # Prettier write
pnpm format:check           # Prettier check only

# Rust backend (run from src-tauri/)
cargo test --verbose        # Run Rust tests
cargo fmt --check           # Check formatting
cargo clippy -- -D warnings # Lint
```

## Architecture

### Frontend → Backend IPC

Three Tauri commands exposed from Rust:
- `create_session` → spawns a PTY, returns `session_id`
- `write_input(session_id, data)` → writes to PTY stdin
- `resize_pty(session_id, cols, rows)` → resizes PTY

One event emitted from backend to frontend:
- `terminal-event` → tagged union with kinds: `output`, `block`, `alternate_screen`

### Backend (src-tauri/src/)

- **`pty.rs`** — Core logic. `PtyManager` manages PTY sessions. `OutputParser` parses raw terminal output, detecting OSC 133 block markers (prompt_start/input_start/command_start/command_end) and alternate screen buffer toggles (`\x1b[?1049h/l`). Strips other OSC sequences silently.
- **`lib.rs`** — Tauri app setup, command handler registration, and `AppState` with `Arc<PtyManager>`.
- **Shell integration (`shell-integration/tome.zsh`)** — Injected via ZDOTDIR override. Adds zsh hooks that emit OSC 133 markers at shell lifecycle points.

### Frontend (src/)

- **`hooks/useTerminalSession.ts`** — Single hook managing all terminal state: session lifecycle, block creation/update from events, phase state machine (idle→prompt→input→running), command history capture, block selection.
- **`components/Block.tsx`** — Renders a command block with ANSI-colored output, exit code badge, and duration. Contains `formatDuration` helper.
- **`components/InputEditor.tsx`** — CodeMirror 6 editor with Enter-to-submit, Shift+Enter for newline, and ↑/↓ command history navigation.
- **`components/FullscreenTerminal.tsx`** — xterm.js terminal for alternate screen programs (vim, htop).
- **`components/BlockList.tsx`** — Scrollable block container with auto-scroll and selection management.

### Key Keyboard Shortcuts

**Block Navigation**: `Cmd+K` clear blocks, `Cmd+↑/↓` navigate blocks, `Cmd+Shift+C` copy selected output.

**Fullscreen Terminal (AI tools)**: `Cmd+Delete` clear line, `Cmd+←/→` jump to line start/end, `Shift+Enter` soft newline.

## Conventions

- **Package manager**: pnpm
- **Prettier**: 100 char width, single quotes, no semicolons, trailing commas ES5
- **CSS**: Light theme via CSS variables in App.css (`--bg-primary`, `--accent`, etc.)
- **Rust errors**: `Result<T, String>` pattern for IPC command handler error propagation
- **React**: Functional components with hooks, `memo()` for performance-sensitive components
- **CI**: GitHub Actions runs three jobs on macOS — `test-rust`, `test-frontend`, `build-tauri`
- **Comments**: All code comments must be in English
- **Pull Requests**: All PR titles and descriptions must be in English

### Critical Layout Requirements (macOS Traffic Lights)

The app uses Tauri's `"titleBarStyle": "Overlay"` configuration which renders macOS traffic lights (close/minimize/maximize buttons) directly over window content. **This requires special handling:**

1. **CSS Variable**: `--traffic-lights-height: 28px` is defined in `:root` in `App.css`. This is the source of truth for the traffic lights area height.

2. **Required Padding**: The `.app` container must have `padding-top: var(--traffic-lights-height)` to prevent content from being obscured by traffic lights.

3. **View Layer Offset**: The `.view-layer` element uses `position: absolute` with `top: var(--traffic-lights-height)`. This is critical — if `top: 0`, content will overlap with traffic lights.

4. **Drag Regions**: Both `.app-drag-region` and `.welcome-drag-region` must have `height: var(--traffic-lights-height)` to allow window dragging.

**When modifying layout code:**
- Always use `var(--traffic-lights-height)` instead of hardcoded `28px`
- If adding new `position: absolute/fixed` elements that cover the full viewport, ensure they respect the traffic lights area
- Include comments explaining why these values are required
- Test both terminal view and welcome page after layout changes

## Pre-Commit Checklist

Before committing code changes, ensure all CI checks pass locally:

```bash
# Rust checks (run from src-tauri/)
cd src-tauri/
cargo fmt -- --check          # Format check
cargo clippy -- -D warnings   # Lint
cargo test                    # Tests

# Frontend checks (run from project root)
pnpm build                    # TypeScript check + Vite build
pnpm test                     # Vitest tests
pnpm format:check             # Prettier check
```

All checks must pass before pushing to remote. The CI will reject PRs that fail any of these checks.
