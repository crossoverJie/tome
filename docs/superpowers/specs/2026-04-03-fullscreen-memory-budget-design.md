# Fullscreen Memory Budget Design

## Summary

Tome's fullscreen Claude white screen is caused by WebKit terminating the WKWebView WebContent process with `ExceededMemoryLimit` during heavy interactive output. The fix is to convert fullscreen rendering into a bounded streaming path with explicit memory ceilings instead of preserving arbitrarily long fullscreen history.

## Root cause

The strongest evidence is from the user-captured macOS system log, which includes:

- `WebProcessProxy::didExceedActiveMemoryLimit`
- `WebProcessProxy::processDidTerminateOrFailedToLaunch: reason=ExceededMemoryLimit`
- `WebPageProxy::processDidTerminate: reason=ExceededMemoryLimit`

This explains the observed symptoms:

- the Tome window turns white
- app shortcuts such as `Cmd+T` and `Cmd+D` stop working
- DevTools UI may stay visible, but page JavaScript becomes unresponsive
- the Tauri host process stays alive because the process that died is the embedded WebKit content process

## Goals

1. Prevent fullscreen Claude sessions from pushing WebContent over WebKit's active memory limit.
2. Preserve the current fullscreen interaction model for normal usage.
3. Degrade long-session history retention intentionally and predictably instead of allowing catastrophic renderer death.
4. Keep the fix local to the fullscreen terminal path.

## Non-goals

1. Preserve unlimited fullscreen scrollback.
2. Add a post-crash recovery flow for a dead WebContent process.
3. Rework the block-mode terminal architecture.

## Approaches considered

### 1. Hard memory budget for fullscreen mode (chosen)

Apply three constraints together:

- conservative xterm scrollback cap
- batched writes into xterm instead of immediate write-per-chunk behavior
- bounded recent-history window for fullscreen hydration/replay

**Why this wins:** it directly targets the active-memory root cause on every layer that can grow under Claude's heavy output load.

### 2. Moderate tuning

Only add batching and small retention adjustments while trying to preserve more history.

**Why not chosen:** useful as an optimization, but weaker than the evidence demands. The current failure is not intermittent UI jank; it is process termination by memory policy.

### 3. Minimal hotspot patch

Touch only one suspected hotspot such as write cadence or xterm options.

**Why not chosen:** too speculative for a root cause that is already proven and severe.

## Design

### 1. Fullscreen terminal becomes a bounded streaming surface

`FullscreenTerminal` should stop behaving like a continuously growing replay target. Instead, it should maintain only the amount of terminal state and historical output needed for a stable active session.

Planned constraints:

- **xterm scrollback cap:** set a conservative fixed line limit for fullscreen mode
- **write batching:** buffer incoming output briefly and flush it to xterm on a scheduled cadence
- **history window:** retain only the latest replayable fullscreen output segment

The intended effect is that no single layer can grow without limit, even during long Claude runs with heavy incremental output.

### 2. Batched xterm writes

Today, incremental output can be written directly into xterm whenever `rawOutput` grows. Under Claude, this can create too much JS/render churn. The new design adds a pending-write queue inside `FullscreenTerminal`:

- collect newly appended output into a queue
- flush at most once per scheduling tick
- coalesce adjacent chunks before calling `terminal.write(...)`
- force-flush on visibility changes and unmount so the terminal state stays coherent

This preserves correctness while reducing high-frequency work inside WebKit and xterm.

### 3. Explicit fullscreen history truncation

The previous raw-output cap was necessary but not sufficient because the terminal itself can still retain too much state. The new design keeps a dedicated fullscreen history budget:

- retain only the latest window needed for hydration and recent scrollback
- when the budget is exceeded, drop the oldest fullscreen history intentionally
- keep offsets absolute so hydration and incremental writes remain correct after truncation

This means very old fullscreen output will no longer be guaranteed to exist, but the active session remains usable.

### 4. Conservative defaults

The implementation should introduce named constants for the budget rather than burying magic numbers in component logic. Initial values should favor stability:

- a low fullscreen scrollback cap
- a short write-flush cadence
- a recent-history window sized for practical recovery, not archival retention

These constants should live close to the fullscreen terminal logic so future tuning is straightforward.

### 5. UX impact

Normal Claude interaction should stay the same:

- live output continues to stream
- keyboard interaction remains intact
- recent content remains scrollable

Intentional degradation:

- in very long sessions, older fullscreen content will no longer be available when scrolling far upward

This trade-off is acceptable because the approved priority is to eliminate white screens first.

## Components affected

### `src/components/FullscreenTerminal.tsx`

Primary ownership:

- xterm options, including scrollback
- pending write queue and flush scheduler
- hydration from retained fullscreen history
- lifecycle cleanup for queued writes

### `src/hooks/useTerminalSession.ts`

Responsibilities:

- continue to own the bounded raw output state
- align retained fullscreen history with the stricter fullscreen budget
- preserve absolute offsets used by hydration/incremental write logic

### `src/utils/rawOutputBuffer.ts`

May need to distinguish between the general raw-output cap and a stricter fullscreen replay budget, depending on how much logic can be shared cleanly.

### Tests

Add or update tests to cover:

- batched write flushing
- correctness after history truncation
- hydration when the retained buffer no longer starts at offset zero
- no duplicate or skipped output after coalesced flushes

## Error handling and diagnostics

Existing diagnostics stay in place during this fix. They are still valuable for confirming:

- write burst frequency falls after batching
- retained fullscreen history stays within budget
- no new hydration or offset bugs are introduced

The fix should not add broad fallback behavior. If terminal state cannot be reconciled, diagnostics should make that visible instead of silently masking it.

## Validation

Before implementation is considered complete:

1. Run `pnpm format:check`
2. Run `pnpm test`
3. Run `pnpm build`

Targeted test additions should focus on the bounded-memory fullscreen path rather than generic UI snapshots.

## Open decisions resolved

The main product decision is already resolved:

- **stability wins over unlimited fullscreen history**

That lets implementation optimize aggressively for staying below WebKit's active-memory limit.
