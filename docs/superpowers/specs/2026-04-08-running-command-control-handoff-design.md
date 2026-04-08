# Running Command Control Handoff Design

## Background

PR #33 added a Warp-style running block, but it only added status feedback. It did not hand terminal control to the running process.

Today, after a command like `npm run dev` starts:

- the pane still renders `InputEditor`
- the browser focus remains on CodeMirror
- `Ctrl+C` is handled by the editor/browser event chain instead of being written to the PTY as `\x03`
- the user can keep typing into a disconnected command box even though the foreground shell job owns stdin

This creates a mismatch between visual state and terminal semantics. The UI says "command running", but the foreground process is not actually controllable from the pane the way users expect from Warp, iTerm, or a native terminal.

## Problem Statement

Tome needs an explicit control handoff when a foreground command is running in block mode:

- editable command input must no longer imply the shell is ready for a new command
- interrupt and job-control keys must reach the PTY reliably
- the UI must still stay lightweight and preserve Tome's block-based model
- interactive fullscreen commands such as Claude/Copilot must keep using the existing `FullscreenTerminal` path

## Goals

1. Make `Ctrl+C` stop a foreground command from the active pane without requiring fullscreen mode.
2. Prevent the user from typing into a misleading editable prompt while a normal foreground command owns stdin.
3. Preserve the current block-mode reading experience for logs and long-running output.
4. Keep the implementation local to the pane/input interaction layer rather than reworking PTY or block parsing.
5. Reuse the existing fullscreen input-routing ideas where possible.

## Non-Goals

1. Replace block mode with a full xterm surface for every command.
2. Implement full readline emulation for arbitrary interactive TUI apps in block mode.
3. Change shell integration markers or PTY backend behavior.
4. Solve background-job management beyond forwarding standard control keys.

## Approaches Considered

### Approach A: Status-only input lock

Keep `InputEditor` visible, mark it read-only, and add a stop button plus a few global shortcuts.

Pros:

- smallest code diff
- minimal visual change

Cons:

- still feels like a broken editor rather than terminal control handoff
- hard to communicate which keys go to PTY and which stay local
- easy to accumulate special cases in `InputEditor`

### Approach B: Full xterm takeover for every running command

Whenever any command enters `running`, switch the whole pane to an xterm-backed terminal surface.

Pros:

- terminal semantics become consistent
- control keys are already solved in `FullscreenTerminal`

Cons:

- too large a UX shift for normal commands
- weak fit for Tome's block-based output model
- higher implementation and regression risk

### Approach C: Lightweight live control bar with PTY handoff

When a non-fullscreen command starts, replace `InputEditor` with a compact running-state control surface. The pane stays in block mode for output, but keyboard control switches to the PTY through a focused hidden input bridge.

Pros:

- fixes `Ctrl+C` and other control keys at the right abstraction layer
- preserves block reading and running block visuals
- clearly communicates that the shell is busy and stdin belongs to the foreground job
- much smaller than a full xterm takeover

Cons:

- requires a new focused input bridge component
- introduces a second input mode in block view

## Recommendation

Adopt Approach C.

This is the best fit for Tome's current architecture because the issue is not lack of output rendering; it is lack of foreground input ownership. A lightweight control surface fixes the semantics without discarding the block-based experience that PR #33 introduced.

## Proposed UX

## 1. Idle state

Current behavior stays unchanged:

- `InputEditor` is visible
- user can type, browse history, request completion, and submit commands

## 2. Foreground command starts

On `block.command_start` for a normal shell command:

- keep `BlockList` visible
- hide `InputEditor`
- show a new `RunningCommandBar` in the input area
- move pane keyboard ownership from CodeMirror to the running-command bridge

The bar should include:

- command preview, truncated to one line
- running status text from existing `runningBlock`
- explicit shortcut hints such as `Ctrl+C interrupt`, `Ctrl+Z suspend`
- optional stop button that sends `\x03`

The bar should look like a transient terminal control surface, not an editor with disabled styling.

## 3. Running command interaction

While `RunningCommandBar` is active:

- `Ctrl+C` sends `\x03`
- `Ctrl+Z` sends `\x1a`
- `Enter` sends `\r`
- plain text input is not accepted into a fake command line
- optional future support can forward a narrow allowlist of additional control keys

If the user clicks the pane while a command is running, focus should return to the running-command bridge, not to a hidden or disabled CodeMirror instance.

## 4. Command completes

On `block.command_end`:

- remove `RunningCommandBar`
- restore `InputEditor`
- focus returns to CodeMirror if the pane is focused

This restores the exact current idle workflow.

## Interaction Semantics

The important rule is:

> In block mode, only one surface owns keyboard input at a time.

Ownership should be:

- `InputEditor` when phase is `input`
- `RunningCommandBar` when phase is `running` and fullscreen terminal is not active
- `FullscreenTerminal` when interactive/fullscreen mode is active

This removes the current ambiguous state where the pane is visually "running" but logically still behaves like an editable prompt.

## Architecture Changes

### Frontend

#### 1. Add explicit pane input mode

Extend `useTerminalSession` to expose a small derived mode instead of making the view infer from scattered booleans.

Suggested shape:

```ts
type PaneInputMode = 'editor' | 'running-control' | 'fullscreen-terminal'
```

Derivation:

- `fullscreen-terminal` when `isFullscreenTerminalActive`
- `running-control` when `runningBlock !== null` and not fullscreen
- `editor` otherwise

This becomes the single source of truth for focus, rendering, and keyboard routing.

#### 2. Add `sendControlInput(data: string)`

Keep `sendInput()` for editor/full terminal text submission, and add a narrow helper for raw control sequences:

```ts
sendControlInput('\x03')
sendControlInput('\x1a')
sendControlInput('\r')
```

This avoids overloading editor submission semantics with special-case key routing.

Implementation can still call the existing Tauri `write_input`, but the frontend API should make the intent explicit.

#### 3. Introduce `RunningCommandBar`

Create a new component, likely under `src/components/RunningCommandBar.tsx`.

Responsibilities:

- render current command and status
- own focus when a command is running
- translate a small allowlist of keys into PTY control bytes
- expose an interrupt button
- display shortcut help

Non-responsibilities:

- command editing
- completion
- command history
- freeform terminal emulation

#### 4. Keep `InputEditor` purely editor-oriented

`InputEditor` should stop trying to represent a busy shell. Its `busy` prop can remain for minor styling if useful, but the main running-state ownership should move out of it.

That keeps CodeMirror logic simpler and avoids mixing editor behaviors with PTY control semantics.

#### 5. Update `PaneView`

`PaneView` becomes the router:

- render `InputEditor` only in `editor` mode
- render `RunningCommandBar` only in `running-control` mode
- render `FullscreenTerminal` only in `fullscreen-terminal` mode

This is the clearest place to express input ownership.

### Backend

No backend protocol changes are required for the first version.

The existing `write_input(sessionId, data)` IPC is sufficient because PTY control characters are already just bytes written to stdin.

Optional later enhancement:

- add a small `send_signal(sessionId, signal)` command if the team wants OS-level interrupts independent of stdin semantics

This should not be part of the first pass because `\x03` already matches user expectation and existing terminal behavior.

## Focus Model

`RunningCommandBar` should not rely on global window shortcuts alone. It needs a real focus target inside the pane so that:

- only the focused pane receives `Ctrl+C`
- split panes behave correctly
- click-to-focus semantics stay consistent with the rest of the app

Recommended implementation:

- render a focusable wrapper `div` with `tabIndex={0}`
- mount an offscreen or visually minimal hidden textarea/input inside it if browser key handling proves inconsistent
- on pane focus, programmatically focus the wrapper/bridge when mode is `running-control`

The key requirement is reliable pane-local keyboard capture, not visible text entry.

## Key Routing Policy

Version 1 should keep the key mapping intentionally small:

- `Ctrl+C` => `\x03`
- `Ctrl+Z` => `\x1a`
- `Enter` => `\r`

Possible optional additions after verification:

- `Ctrl+D` => `\x04`
- `Esc` => `\x1b`

Do not forward arbitrary printable characters in the first version. If a process actually needs arbitrary stdin during block mode, that is usually a signal that it belongs in the fullscreen terminal path rather than the lightweight running-control path.

## State Flow

Normal command:

1. `input_start` => pane mode `editor`
2. user submits command
3. `command_start` => create block, create `runningBlock`, switch pane mode to `running-control`
4. command outputs logs => block updates continue as today
5. user presses `Ctrl+C` => `RunningCommandBar` writes `\x03` to PTY
6. shell emits `command_end` => clear `runningBlock`, switch pane mode back to `editor`

Interactive fullscreen command:

1. user submits `claude`, `gh copilot`, or equivalent
2. existing fullscreen detection runs
3. pane mode becomes `fullscreen-terminal`
4. existing `FullscreenTerminal` keeps owning input

This preserves the current architecture split between standard commands and fullscreen interactive tools.

## Error Handling

If PTY write fails while `RunningCommandBar` sends control input:

- log diagnostics with session id, pane id, key, and current pane mode
- keep the bar visible
- avoid fake optimistic UI such as "Interrupted"

The shell lifecycle markers should remain the source of truth. UI state should only reset on `command_end`.

## Testing Scope

### `useTerminalSession`

Add tests for:

- derived `paneInputMode`
- switching to `running-control` on normal `command_start`
- remaining in `fullscreen-terminal` for interactive commands
- restoring `editor` on `command_end`
- `sendControlInput` writing raw control bytes to IPC

### `PaneView`

Add tests for:

- rendering `RunningCommandBar` instead of `InputEditor` during a running command
- not rendering `RunningCommandBar` during fullscreen terminal mode
- focus handoff to running-control surface when pane is focused

### `RunningCommandBar`

Add tests for:

- `Ctrl+C` invokes PTY write with `\x03`
- `Ctrl+Z` invokes PTY write with `\x1a`
- interrupt button invokes PTY write with `\x03`
- plain printable key presses do not append visible text

## Rollout Plan

### Phase 1

Ship the core handoff:

- pane input mode
- `RunningCommandBar`
- `Ctrl+C`, `Ctrl+Z`, `Enter`
- interrupt button

### Phase 2

Refine ergonomics if needed:

- add `Ctrl+D`
- improve copy/help text
- evaluate whether some commands should automatically escalate to fullscreen control mode

## Tradeoffs

This design intentionally does not support arbitrary interactive stdin in block mode. That is a feature, not a bug.

Tome's strength is readable command blocks plus a dedicated fullscreen path for fully interactive tools. The running-command control bar should solve the common case of long-running foreground commands that mostly need observation plus occasional interruption, without turning block mode into a half-terminal.

## Success Criteria

The design is successful if:

1. Running `npm run dev` and pressing `Ctrl+C` from the focused pane reliably stops the process.
2. While the command is running, the pane no longer shows an editable prompt that suggests a new command can be typed.
3. When the command exits, the normal editor prompt returns automatically.
4. Split panes route control keys only to the focused pane.
5. Existing fullscreen interactive command behavior remains unchanged.
