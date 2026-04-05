# Fullscreen Memory Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent fullscreen Claude sessions from white-screening Tome by keeping the WKWebView/xterm path inside a hard memory budget, even during very long, high-output conversations.

**Architecture:** Keep the fix local to the fullscreen terminal path. Add explicit fullscreen memory-budget constants, make `useTerminalSession` enforce a stricter retained-output window while fullscreen is active, and make `FullscreenTerminal` coalesce stream writes instead of calling `terminal.write(...)` on every update. This preserves live interaction while intentionally sacrificing deep fullscreen scrollback.

**Tech Stack:** React 19, TypeScript, Vitest, xterm.js, Tauri 2

---

## File map

- Modify: `src/utils/rawOutputBuffer.ts`
  - Add reusable buffer-budget definitions so the session layer can apply a stricter replay window during fullscreen mode.
- Modify: `src/utils/rawOutputBuffer.test.ts`
  - Add unit coverage for configurable budgets and truncation behavior.
- Modify: `src/hooks/useTerminalSession.ts`
  - Apply the fullscreen-specific replay budget when Claude/interactive fullscreen is active, while preserving absolute offsets.
- Modify: `src/hooks/useTerminalSession.test.tsx`
  - Cover stricter fullscreen retention and ensure offsets still advance correctly.
- Modify: `src/components/FullscreenTerminal.tsx`
  - Add xterm scrollback cap, queue incremental writes, flush them on a short cadence, and force-flush on deactivate/unmount.
- Modify: `src/components/FullscreenTerminal.test.tsx`
  - Cover coalesced writes, flush timing, and the xterm scrollback option.

---

### Task 1: Introduce explicit fullscreen buffer budgets

**Files:**
- Modify: `src/utils/rawOutputBuffer.ts`
- Test: `src/utils/rawOutputBuffer.test.ts`

- [ ] **Step 1: Write the failing buffer-budget test**

Add a test that proves the helper can use a stricter fullscreen budget than the default raw-output budget:

```ts
import {
  FULLSCREEN_REPLAY_BUFFER_LIMIT,
  FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
  appendRawOutputChunk,
} from './rawOutputBuffer'

it('supports a stricter fullscreen replay budget', () => {
  const result = appendRawOutputChunk(
    {
      rawOutput: 'a'.repeat(FULLSCREEN_REPLAY_BUFFER_LIMIT - 2),
      rawOutputBaseOffset: 40,
    },
    'bcdef',
    {
      limit: FULLSCREEN_REPLAY_BUFFER_LIMIT,
      trimTarget: FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
    }
  )

  expect(result.didTrim).toBe(true)
  expect(result.rawOutput.length).toBe(FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET)
  expect(result.rawOutputBaseOffset).toBe(
    40 + (FULLSCREEN_REPLAY_BUFFER_LIMIT - 2 + 5 - FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET)
  )
})
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run:

```bash
pnpm test -- src/utils/rawOutputBuffer.test.ts
```

Expected: FAIL because `appendRawOutputChunk` does not yet accept a budget argument and the fullscreen constants do not exist.

- [ ] **Step 3: Implement configurable buffer budgets**

Update `src/utils/rawOutputBuffer.ts` so callers can opt into a stricter fullscreen replay window:

```ts
export interface RawOutputBufferBudget {
  limit: number
  trimTarget: number
}

export const RAW_OUTPUT_BUFFER_LIMIT = 1024 * 1024
export const RAW_OUTPUT_BUFFER_TRIM_TARGET = 768 * 1024

export const FULLSCREEN_REPLAY_BUFFER_LIMIT = 256 * 1024
export const FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET = 192 * 1024

const DEFAULT_RAW_OUTPUT_BUFFER_BUDGET: RawOutputBufferBudget = {
  limit: RAW_OUTPUT_BUFFER_LIMIT,
  trimTarget: RAW_OUTPUT_BUFFER_TRIM_TARGET,
}

export function appendRawOutputChunk(
  state: RawOutputBufferState,
  chunk: string,
  budget: RawOutputBufferBudget = DEFAULT_RAW_OUTPUT_BUFFER_BUDGET
): AppendedRawOutputBuffer {
  const nextRawOutput = state.rawOutput + chunk
  if (nextRawOutput.length <= budget.limit) {
    return {
      rawOutput: nextRawOutput,
      rawOutputBaseOffset: state.rawOutputBaseOffset,
      didTrim: false,
      trimmedCharCount: 0,
    }
  }

  const trimStart = nextRawOutput.length - budget.trimTarget
  return {
    rawOutput: nextRawOutput.slice(trimStart),
    rawOutputBaseOffset: state.rawOutputBaseOffset + trimStart,
    didTrim: true,
    trimmedCharCount: trimStart,
  }
}
```

- [ ] **Step 4: Run the buffer tests to verify they pass**

Run:

```bash
pnpm test -- src/utils/rawOutputBuffer.test.ts
```

Expected: PASS, including the new stricter-budget case.

- [ ] **Step 5: Commit**

```bash
git add src/utils/rawOutputBuffer.ts src/utils/rawOutputBuffer.test.ts
git commit -m "fix: add fullscreen replay buffer budgets

- add explicit fullscreen replay limits separate from the general raw output cap
- allow appendRawOutputChunk callers to choose a stricter trim budget
- cover configurable truncation behavior with focused unit tests

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Enforce the stricter replay budget in `useTerminalSession`

**Files:**
- Modify: `src/hooks/useTerminalSession.ts`
- Test: `src/hooks/useTerminalSession.test.tsx`

- [ ] **Step 1: Write the failing fullscreen-budget hook test**

Add a test beside the current trim/offset coverage:

```tsx
import {
  FULLSCREEN_REPLAY_BUFFER_LIMIT,
  FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
} from '../utils/rawOutputBuffer'

it('uses the fullscreen replay budget while an interactive fullscreen command is active', async () => {
  const { result } = renderHook(() => useTerminalSession('pane-1'))

  await waitFor(() => {
    expect(result.current.sessionId).toBe('session-1')
  })

  act(() => {
    result.current.sendInput('claude\n')
    result.current.notifyFullscreenReady(120, 40)
    terminalEventListener?.({
      payload: {
        kind: 'block',
        session_id: 'session-1',
        event_type: 'command_start',
        exit_code: null,
      },
    })
  })

  act(() => {
    terminalEventListener?.({
      payload: {
        kind: 'raw_output',
        session_id: 'session-1',
        data: 'x'.repeat(FULLSCREEN_REPLAY_BUFFER_LIMIT + 32),
      },
    })
  })

  expect(result.current.rawOutput.length).toBe(FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET)
  expect(result.current.rawOutputBaseOffset).toBe(
    FULLSCREEN_REPLAY_BUFFER_LIMIT + 32 - FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET
  )
})
```

- [ ] **Step 2: Run the hook test to verify it fails**

Run:

```bash
pnpm test -- src/hooks/useTerminalSession.test.tsx
```

Expected: FAIL because fullscreen mode still uses the general `RAW_OUTPUT_BUFFER_*` budget.

- [ ] **Step 3: Apply the fullscreen-specific replay budget**

Update `src/hooks/useTerminalSession.ts` so `appendRawOutput` chooses the stricter budget whenever `isFullscreenTerminalActive` is true:

```ts
import {
  FULLSCREEN_REPLAY_BUFFER_LIMIT,
  FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
  appendRawOutputChunk,
  getRawOutputAbsoluteEnd,
} from '../utils/rawOutputBuffer'

const FULLSCREEN_REPLAY_BUFFER_BUDGET = {
  limit: FULLSCREEN_REPLAY_BUFFER_LIMIT,
  trimTarget: FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
}

const isFullscreenTerminalActiveRef = useRef(isFullscreenTerminalActive)

useEffect(() => {
  isFullscreenTerminalActiveRef.current = isFullscreenTerminalActive
}, [isFullscreenTerminalActive])

const next = appendRawOutputChunk(
  {
    rawOutput: prev,
    rawOutputBaseOffset: previousBaseOffset,
  },
  data,
  isFullscreenTerminalActiveRef.current
    ? FULLSCREEN_REPLAY_BUFFER_BUDGET
    : undefined
)
```

Do **not** rely on the listener effect re-subscribing when fullscreen mode changes. The `terminal-event` listener is long-lived, so `appendRawOutput` must read the latest fullscreen state from a ref. Keep the rest of the absolute-offset logic intact. Do not reset `fullscreenOutputStart`; the retained window may shift, but offsets still need to refer to absolute positions.

- [ ] **Step 4: Run the hook tests to verify they pass**

Run:

```bash
pnpm test -- src/hooks/useTerminalSession.test.tsx
```

Expected: PASS, including the new fullscreen-budget assertion and the existing offset-shift coverage.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTerminalSession.ts src/hooks/useTerminalSession.test.tsx
git commit -m "fix: cap fullscreen replay history in session state

- switch fullscreen interactive sessions to a stricter replay budget
- preserve absolute offsets so hydration and incremental streaming stay correct
- add hook coverage for fullscreen-specific truncation behavior

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Batch fullscreen writes and cap xterm scrollback

**Files:**
- Modify: `src/components/FullscreenTerminal.tsx`
- Test: `src/components/FullscreenTerminal.test.tsx`

- [ ] **Step 1: Write the failing batching and scrollback tests**

Add two focused tests:

```tsx
import { Terminal } from '@xterm/xterm'

it('coalesces multiple stream updates into one terminal write per flush', () => {
  const onData = vi.fn()
  const onResize = vi.fn()
  const onReady = vi.fn()

  const { rerender } = render(
    <FullscreenTerminal
      sessionId={'session-1'}
      visible={true}
      isFocused={true}
      startOffset={6}
      onData={onData}
      onResize={onResize}
      onReady={onReady}
      rawOutput={'shell\nclaude'}
    />
  )

  act(() => {
    vi.runAllTimers()
  })

  terminalMocks.write.mockClear()

  rerender(
    <FullscreenTerminal
      sessionId={'session-1'}
      visible={true}
      isFocused={true}
      startOffset={6}
      onData={onData}
      onResize={onResize}
      onReady={onReady}
      rawOutput={'shell\nclaude/model'}
    />
  )

  rerender(
    <FullscreenTerminal
      sessionId={'session-1'}
      visible={true}
      isFocused={true}
      startOffset={6}
      onData={onData}
      onResize={onResize}
      onReady={onReady}
      rawOutput={'shell\nclaude/model/status'}
    />
  )

  expect(terminalMocks.write).not.toHaveBeenCalled()

  act(() => {
    vi.runOnlyPendingTimers()
  })

  expect(terminalMocks.write).toHaveBeenCalledWith('/model/status')
})

it('creates the fullscreen xterm with a conservative scrollback cap', () => {
  const onData = vi.fn()
  const onResize = vi.fn()
  const onReady = vi.fn()

  render(
    <FullscreenTerminal
      sessionId={'session-1'}
      visible={true}
      isFocused={true}
      startOffset={0}
      onData={onData}
      onResize={onResize}
      onReady={onReady}
      rawOutput={'claude ui'}
    />
  )

  const terminalCtor = vi.mocked(Terminal)
  expect(terminalCtor).toHaveBeenCalledWith(
    expect.objectContaining({
      scrollback: 1000,
    })
  )
})
```

- [ ] **Step 2: Run the fullscreen terminal test file to verify it fails**

Run:

```bash
pnpm test -- src/components/FullscreenTerminal.test.tsx
```

Expected: FAIL because writes are still immediate and the `Terminal` constructor does not set `scrollback`.

- [ ] **Step 3: Implement queued writes and xterm scrollback caps**

Update `src/components/FullscreenTerminal.tsx` with explicit constants and a queued flush path:

```ts
const FULLSCREEN_SCROLLBACK_LINES = 1000
const FULLSCREEN_WRITE_FLUSH_MS = 16

const pendingWriteBufferRef = useRef('')
const writeFlushTimeoutRef = useRef<number | null>(null)

const flushPendingWrites = useCallback(
  (
    reason: 'scheduled-flush' | 'deactivate' | 'unmount',
    force = false
  ) => {
    if (writeFlushTimeoutRef.current !== null) {
      window.clearTimeout(writeFlushTimeoutRef.current)
      writeFlushTimeoutRef.current = null
    }

    if (!terminalRef.current || pendingWriteBufferRef.current.length === 0) {
      return
    }

    const pending = pendingWriteBufferRef.current
    pendingWriteBufferRef.current = ''

    terminalRef.current.write(pending)
    recordTerminalWrite(pending.length, reason)
  },
  [recordTerminalWrite]
)

const enqueueTerminalWrite = useCallback(
  (data: string) => {
    if (data.length === 0) {
      return
    }

    pendingWriteBufferRef.current += data
    if (writeFlushTimeoutRef.current !== null) {
      return
    }

    writeFlushTimeoutRef.current = window.setTimeout(() => {
      flushPendingWrites('scheduled-flush', true)
    }, FULLSCREEN_WRITE_FLUSH_MS)
  },
  [flushPendingWrites]
)

const terminal = new Terminal({
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: 14,
  scrollback: FULLSCREEN_SCROLLBACK_LINES,
  theme: {
    background: '#1a1a2e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
  },
  altClickMovesCursor: false,
  cursorBlink: true,
})
```

Replace direct incremental writes in the stream effect with queued writes:

```ts
const newData = rawOutput.slice(relativeWriteStart)
lastWrittenRef.current = absoluteEndOffset
enqueueTerminalWrite(newData)
```

Before deactivation and unmount, force-flush:

```ts
flushPendingWrites('deactivate', true)
flushPendingWrites('unmount', true)
```

- [ ] **Step 4: Run the fullscreen terminal tests to verify they pass**

Run:

```bash
pnpm test -- src/components/FullscreenTerminal.test.tsx
```

Expected: PASS, including the new coalesced-write and scrollback assertions, plus the existing hydration/offset/focus tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/FullscreenTerminal.tsx src/components/FullscreenTerminal.test.tsx
git commit -m "fix: batch fullscreen terminal writes under a hard memory budget

- cap fullscreen xterm scrollback to reduce retained terminal memory
- coalesce high-frequency output before writing into xterm
- add focused tests for batched writes and constructor scrollback options

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Run the full frontend regression suite

**Files:**
- Modify: `docs/superpowers/plans/2026-04-03-fullscreen-memory-budget.md` (check off completed steps only if you are executing the plan)
- Verify: `src/utils/rawOutputBuffer.ts`
- Verify: `src/hooks/useTerminalSession.ts`
- Verify: `src/components/FullscreenTerminal.tsx`

- [ ] **Step 1: Run the focused frontend tests together**

Run:

```bash
pnpm test -- src/utils/rawOutputBuffer.test.ts src/hooks/useTerminalSession.test.tsx src/components/FullscreenTerminal.test.tsx
```

Expected: PASS for all focused bounded-memory tests.

- [ ] **Step 2: Run the repository frontend test suite**

Run:

```bash
pnpm test
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 3: Run formatting and production build**

Run:

```bash
pnpm format:check && pnpm build
```

Expected: Prettier check passes and the Vite/TypeScript production build succeeds.

- [ ] **Step 4: Review diagnostics output during a manual Claude fullscreen stress check**

Use the existing diagnostics rather than adding more instrumentation. Reproduce the previous high-output fullscreen Claude scenario and verify:

```js
window.__TOME_DIAGNOSTICS__?.slice(-20)
```

Expected:

- no new hydration truncation loop
- terminal write logs show fewer, larger bursts instead of per-chunk spam
- no new renderer failure entries before or during the stress run

- [ ] **Step 5: Commit**

```bash
git add src/utils/rawOutputBuffer.ts src/utils/rawOutputBuffer.test.ts src/hooks/useTerminalSession.ts src/hooks/useTerminalSession.test.tsx src/components/FullscreenTerminal.tsx src/components/FullscreenTerminal.test.tsx
git commit -m "test: verify fullscreen memory budget fix end to end

- run focused bounded-memory coverage for fullscreen replay and streaming
- validate the full frontend test/build/format pipeline
- confirm diagnostics remain clean during manual fullscreen stress checks

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
