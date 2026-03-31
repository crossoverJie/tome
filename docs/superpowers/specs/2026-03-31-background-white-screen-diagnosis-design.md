# Background white screen diagnosis design

## Problem

After a fullscreen Claude session is left in the background for some time and the user returns to Tome, the window can come back as a fully white content area. The screenshot indicates this is not limited to the xterm viewport: the tab bar and split-pane chrome are also gone, and keyboard shortcuts such as `Cmd+T` and `Cmd+D` no longer respond.

That symptom means the current working theory must expand beyond terminal redraw issues. We need to determine whether the renderer is crashing, the React tree is unmounting, the root container is being emptied/hidden, or the fullscreen state machine is leaving the app in an unrecoverable UI state.

## Goal

Add targeted diagnostics that let one reproduction answer these questions:

1. What lifecycle event happened immediately before the white screen?
2. Is the renderer still alive when the white screen is visible?
3. Does the React/root DOM tree still exist?
4. What pane/tab/fullscreen/session state does the app believe it is in?
5. Is the fullscreen terminal host still attached and hydrated?

This phase is diagnostic only. It should not change fullscreen recovery behavior unless the diagnostic wiring itself requires a minimal safety guard.

## Recommended approach

Use a layered diagnostic path:

1. Add structured lifecycle logging around browser/window visibility and focus transitions.
2. Add app-level state snapshots for tabs, panes, fullscreen flags, and root DOM presence.
3. Add fullscreen terminal host lifecycle logs so we can see attach/detach/hydrate/redraw ordering.
4. Add renderer error capture (`window.onerror`, `unhandledrejection`, React error boundary) to distinguish render crashes from state bugs.

This is preferred over more speculative redraw fixes because the current symptom suggests the failure may be above xterm, and each additional blind recovery attempt makes the real cause harder to isolate.

## Instrumentation design

### 1. Shared debug logger

Create a lightweight frontend logger with these properties:

- disabled by default in normal use
- enabled in development / diagnostic runs
- structured payloads rather than ad-hoc strings
- timestamped events so ordering is unambiguous

Each log entry should include:

- event name
- current timestamp
- route/component source
- focused pane id when available
- active fullscreen session id when available

### 2. Window and document lifecycle probes

Log these transitions:

- `document.visibilitychange`
- `window.focus`
- `window.blur`
- `window.resize`
- `pageshow`
- `pagehide` if it occurs in the WebView lifecycle

For each event, capture:

- `document.visibilityState`
- `document.hasFocus()`
- `window.innerWidth` / `window.innerHeight`
- whether the app root element exists
- root child count

### 3. React/app tree probes

At the app shell level, log:

- `App` mount/unmount
- tab count and active tab id
- pane count and focused pane id
- whether any pane is in fullscreen interactive mode

At the pane level, log:

- `PaneView` mount/unmount
- `paneId`
- `isFocused`
- `isFullscreenTerminalActive`
- bound `sessionId`

These logs will tell us whether the renderer is still reconciling the expected tree after the app returns from the background.

### 4. Fullscreen terminal probes

Inside `FullscreenTerminal`, log:

- host acquire/release and delayed disposal
- container attach/detach
- activation retries while waiting for non-zero size
- hydration start/finish
- redraw triggers with their source (`resize`, `visibility`, `focus`, `observer`)
- terminal dimensions before and after fit
- host DOM attachment status

Snapshot fields should include:

- `sessionId`
- `visible`
- `isFocused`
- `host.hydrated`
- `host.startOffset`
- `host.lastWritten`
- terminal `cols` / `rows`
- container `clientWidth` / `clientHeight`

### 5. Renderer failure capture

Add diagnostic capture for:

- `window.onerror`
- `window.unhandledrejection`
- a small React error boundary around the app content area

If an error boundary trips, it should log the error and a final UI snapshot before rendering a minimal fallback. This is diagnostic first: the main purpose is to prove whether the white screen is caused by a render-time exception.

## Data flow

1. Background / foreground lifecycle event fires.
2. Logger records browser/window event and root DOM snapshot.
3. React components log any mount/unmount or state transition caused by that event.
4. `FullscreenTerminal` logs host/container/hydration/redraw activity.
5. If the renderer throws, global handlers or the error boundary record the failure.
6. After reproduction, the ordered log stream reveals whether the break happened at the browser lifecycle layer, React layer, pane state layer, or xterm host layer.

## Error handling

- Diagnostic logging must never throw.
- Any logger serialization should be defensive and shallow.
- Error boundary fallback must be minimal and deterministic.
- If diagnostic capture fails, the app should continue with current behavior rather than masking the original issue.

## Testing

Add small tests only for the diagnostic wiring:

- logger does not emit when disabled
- logger emits structured entries when enabled
- error boundary logs captured render errors

Do not attempt to unit test the full white-screen reproduction itself in this phase. The primary validation is a manual reproduction with logs collected from a development build.

## Manual validation plan

1. Start Tome with diagnostics enabled.
2. Open a fullscreen Claude session.
3. Leave the app in the background long enough to trigger the issue.
4. Return to the app and reproduce the white screen.
5. Inspect the ordered logs to classify the failure into one of:
   - renderer crash
   - app/root tree removed
   - pane/fullscreen state corruption
   - xterm host detached or zero-sized
   - browser/WebView lifecycle anomaly with live renderer

## Out of scope

- shipping a final recovery fix in the same change
- adding persistent file logging or telemetry upload
- refactoring unrelated pane/tab logic
- changing fullscreen UX again before the root cause is identified
