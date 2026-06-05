# File-Open Loading Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a prominent, blocking modal overlay (spinner + filename + live elapsed time + Cancel) for every File→Open path, so the user can tell the app is loading and can abort a wrong/huge open.

**Architecture:** A new `fileOpen` slice in the zustand store holds the in-progress open. `FileTab.handleOpen` sets it (via a monotonic token) at the start of all three open branches (STEP, ZIP, native) and clears it in `finally`. A new `FileOpenOverlay` component (mounted in `App.tsx`) renders while `fileOpen` is non-null and computes elapsed time locally. Cancel reuses the existing kernel-restart path (`handleRestart`) — the only way to actually stop a blocking OCCT parse is to terminate + respawn the worker. A monotonic `fileOpenSeq` token invalidates the abandoned in-flight open so its late rejection shows no error dialog, and gates the existing footer status ticker so it stops writing after a cancel.

**Tech Stack:** React + TypeScript, zustand, Vitest + @testing-library/react (unit), Playwright (e2e), OCCT-in-WebWorker via Comlink.

**Spec:** `docs/superpowers/specs/2026-06-05-file-open-loading-overlay-design.md`

---

## File Structure

| File | Responsibility | Create/Modify |
|------|----------------|---------------|
| `packages/app/src/store/useAppStore.ts` | `fileOpen` state + `fileOpenSeq` token + `beginFileOpen`/`endFileOpen`/`cancelFileOpen` actions | Modify |
| `packages/app/src/store/fileOpen.spec.ts` | Unit tests for the slice | Create |
| `packages/app/src/import/importTicker.ts` | Add optional `isCurrent` gate so the footer ticker stops after cancel/supersede | Modify |
| `packages/app/src/import/importTicker.spec.ts` | Unit test for the gate | Create |
| `packages/app/src/shell/FileOpenOverlay.tsx` | Blocking modal overlay (spinner, filename, elapsed, hint, Cancel) | Create |
| `packages/app/src/shell/FileOpenOverlay.test.tsx` | Unit tests for the overlay | Create |
| `packages/app/src/shell/tabs/FileTab.tsx` | Set/clear `fileOpen` around all open branches; gate ticker by token | Modify |
| `packages/app/src/App.tsx` | Mount `<FileOpenOverlay>`; add `handleCancelOpen` (reuses `handleRestart`) | Modify |
| `tests/e2e/file-open-overlay.spec.ts` | E2E: overlay shows during open, clears after import | Create |
| `tests/e2e/file-open-overlay-cancel.spec.ts` | E2E: Cancel dismisses overlay, restarts kernel, no error | Create |

---

## Task 1: Store `fileOpen` slice

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (interface near `:132`, signatures near `:209`, defaults near `:372`, actions near `:427`)
- Test: `packages/app/src/store/fileOpen.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/store/fileOpen.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';

describe('fileOpen store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ fileOpen: null, fileOpenSeq: 0 });
  });

  it('beginFileOpen sets fileOpen and returns an incrementing token', () => {
    const token = useAppStore.getState().beginFileOpen('cube.step');
    const s = useAppStore.getState();
    expect(s.fileOpen?.fileName).toBe('cube.step');
    expect(typeof s.fileOpen?.startedAtMs).toBe('number');
    expect(token).toBe(1);
  });

  it('endFileOpen clears fileOpen when the token is current', () => {
    const token = useAppStore.getState().beginFileOpen('cube.step');
    useAppStore.getState().endFileOpen(token);
    expect(useAppStore.getState().fileOpen).toBeNull();
  });

  it('endFileOpen with a stale token does NOT clear a newer open', () => {
    const stale = useAppStore.getState().beginFileOpen('a.step');
    useAppStore.getState().beginFileOpen('b.step'); // newer open → token 2
    useAppStore.getState().endFileOpen(stale);       // stale token 1
    expect(useAppStore.getState().fileOpen?.fileName).toBe('b.step');
  });

  it('cancelFileOpen clears fileOpen and invalidates the current token', () => {
    const token = useAppStore.getState().beginFileOpen('big.step');
    useAppStore.getState().cancelFileOpen();
    expect(useAppStore.getState().fileOpen).toBeNull();
    useAppStore.getState().endFileOpen(token); // stale end must not resurrect state
    expect(useAppStore.getState().fileOpen).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/store/fileOpen.spec.ts`
Expected: FAIL — `beginFileOpen is not a function` / property `fileOpen` missing.

- [ ] **Step 3: Add the interface fields**

In `packages/app/src/store/useAppStore.ts`, immediately after `statusMessage: string;` (line ~132), add:

```ts
  /** Non-null while a File→Open is in progress; drives the blocking FileOpenOverlay. */
  fileOpen: { fileName: string; startedAtMs: number } | null;
  /** Monotonic token; bumped on each open start and on cancel to invalidate stale opens. */
  fileOpenSeq: number;
```

In the same interface, near the other action signatures (around `setStatus(msg: string): void;` at line ~209), add:

```ts
  beginFileOpen(fileName: string): number;
  endFileOpen(token: number): void;
  cancelFileOpen(): void;
```

- [ ] **Step 4: Add defaults**

In the `create<AppState>((set) => ({ ... }))` initial state, after `statusMessage: 'Loading…',` (line ~372), add:

```ts
  fileOpen: null,
  fileOpenSeq: 0,
```

- [ ] **Step 5: Add the actions**

After `setStatus: (msg) => set({ statusMessage: msg }),` (line ~427), add. The store factory is `(set) => ({...})` (no `get`), so use the functional `set((s) => ...)` form:

```ts
  beginFileOpen: (fileName) => {
    let token = 0;
    set((s) => {
      token = s.fileOpenSeq + 1;
      return { fileOpenSeq: token, fileOpen: { fileName, startedAtMs: Date.now() } };
    });
    return token;
  },
  endFileOpen: (token) => set((s) => (s.fileOpenSeq === token ? { fileOpen: null } : {})),
  cancelFileOpen: () => set((s) => ({ fileOpenSeq: s.fileOpenSeq + 1, fileOpen: null })),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/store/fileOpen.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/fileOpen.spec.ts
git commit -m "feat(store): fileOpen slice with seq token for open-in-progress state"
```

---

## Task 2: Gate the footer import ticker by token

The footer `startImportTicker` rewrites `statusMessage` every second. Without a gate it would overwrite "Open cancelled" for several seconds after a cancel. Add an optional `isCurrent` predicate (backward compatible) that stops the ticker once the open is superseded/cancelled.

**Files:**
- Modify: `packages/app/src/import/importTicker.ts`
- Test: `packages/app/src/import/importTicker.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/import/importTicker.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startImportTicker } from './importTicker';

describe('startImportTicker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps updating status while isCurrent stays true', () => {
    const msgs: string[] = [];
    const stop = startImportTicker((m) => msgs.push(m), () => true);
    vi.advanceTimersByTime(2000);
    stop();
    // initial message + 2 ticks
    expect(msgs.length).toBe(3);
    expect(msgs[0]).toMatch(/Importing STEP/);
  });

  it('stops writing once isCurrent returns false', () => {
    let current = true;
    const msgs: string[] = [];
    const stop = startImportTicker((m) => msgs.push(m), () => current);
    vi.advanceTimersByTime(1000); // one tick written (length 2)
    current = false;
    vi.advanceTimersByTime(5000); // no further writes
    stop();
    expect(msgs.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/import/importTicker.spec.ts`
Expected: FAIL — the second test sees extra messages (no gate yet).

- [ ] **Step 3: Add the gate**

Replace the body of `packages/app/src/import/importTicker.ts` with:

```ts
/**
 * Starts a live "Importing STEP…" status ticker.
 *
 * Immediately calls `setStatus` with an initial message, then updates it every
 * second with the elapsed time. Returns a `stop` function that clears the
 * interval — call it in a `finally` block to guarantee no timer leaks.
 *
 * `isCurrent` (default: always true) is polled before every write; when it
 * returns false (e.g. the open was cancelled or superseded) the ticker stops
 * writing and clears itself, so it never overwrites a later status message.
 *
 * Calling `stop()` multiple times is safe (idempotent).
 */
export function startImportTicker(
  setStatus: (msg: string) => void,
  isCurrent: () => boolean = () => true,
): () => void {
  const startMs = Date.now();
  if (isCurrent()) {
    setStatus('Importing STEP… (this can take several minutes for large assemblies)');
  }

  const id = setInterval(() => {
    if (!isCurrent()) {
      clearInterval(id);
      return;
    }
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    const label = mm > 0 ? `${mm}:${ss}` : `${elapsed}s`;
    setStatus(`Importing STEP… ${label} elapsed (large assemblies can take several minutes)`);
  }, 1000);

  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      clearInterval(id);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/import/importTicker.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/import/importTicker.ts packages/app/src/import/importTicker.spec.ts
git commit -m "feat(import): gate import ticker on isCurrent so it stops after cancel"
```

---

## Task 3: `FileOpenOverlay` component

**Files:**
- Create: `packages/app/src/shell/FileOpenOverlay.tsx`
- Test: `packages/app/src/shell/FileOpenOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/shell/FileOpenOverlay.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FileOpenOverlay from './FileOpenOverlay';
import { useAppStore } from '../store/useAppStore';

describe('FileOpenOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ fileOpen: null, fileOpenSeq: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing when no file is opening', () => {
    const { container } = render(<FileOpenOverlay onCancel={() => {}} />);
    expect(container.querySelector('[data-testid="file-open-overlay"]')).toBeNull();
  });

  it('shows the filename while opening', () => {
    useAppStore.setState({ fileOpen: { fileName: 'gizmo.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={() => {}} />);
    expect(screen.getByTestId('file-open-overlay')).toBeTruthy();
    expect(screen.getByText(/Opening gizmo\.step/)).toBeTruthy();
  });

  it('updates elapsed time every second', () => {
    useAppStore.setState({ fileOpen: { fileName: 'a.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={() => {}} />);
    expect(screen.getByTestId('file-open-elapsed').textContent).toContain('0s');
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('file-open-elapsed').textContent).toContain('2s');
  });

  it('hides the long-wait hint until 3s elapse', () => {
    useAppStore.setState({ fileOpen: { fileName: 'a.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={() => {}} />);
    expect(screen.queryByText(/take several minutes/i)).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText(/take several minutes/i)).toBeTruthy();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    useAppStore.setState({ fileOpen: { fileName: 'a.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/shell/FileOpenOverlay.test.tsx`
Expected: FAIL — `Cannot find module './FileOpenOverlay'`.

- [ ] **Step 3: Create the component**

Create `packages/app/src/shell/FileOpenOverlay.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

function formatElapsed(sec: number): string {
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return mm > 0 ? `${mm}:${ss}` : `${sec}s`;
}

/**
 * Blocking modal shown while a File→Open is in progress (driven by the store's
 * `fileOpen` slice). Dimmed scrim prevents other commands; the Cancel button
 * aborts via the injected `onCancel` (a hard kernel restart — see the spec).
 */
export default function FileOpenOverlay({ onCancel }: { onCancel: () => void }) {
  const fileOpen = useAppStore((s) => s.fileOpen);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!fileOpen) {
      setElapsedSec(0);
      return;
    }
    const { startedAtMs } = fileOpen;
    setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000));
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [fileOpen]);

  if (!fileOpen) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Opening file"
      data-testid="file-open-overlay"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
    >
      <div className="bg-shell-panel border border-shell-border p-6 w-96 text-xs flex flex-col items-center gap-3">
        <div
          aria-hidden="true"
          className="w-8 h-8 border-2 border-neutral-600 border-t-white rounded-full animate-spin"
        />
        <div className="text-sm">Opening {fileOpen.fileName}…</div>
        <div className="text-neutral-300" data-testid="file-open-elapsed">
          {formatElapsed(elapsedSec)} elapsed
        </div>
        {elapsedSec >= 3 && (
          <div className="text-neutral-400 text-center">
            Large assemblies can take several minutes.
          </div>
        )}
        <button
          onClick={onCancel}
          className="mt-2 px-3 py-1 border border-shell-border hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/shell/FileOpenOverlay.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/FileOpenOverlay.tsx packages/app/src/shell/FileOpenOverlay.test.tsx
git commit -m "feat(shell): FileOpenOverlay blocking modal with elapsed + cancel"
```

---

## Task 4: Wire `FileTab.handleOpen`

Set `fileOpen` at the start of every open branch and clear it in `finally`; gate the footer ticker by the token; swallow the abandoned open's late error after cancel.

**Files:**
- Modify: `packages/app/src/shell/tabs/FileTab.tsx`

> **No-TDD exception (auditable):** `handleOpen` depends on `pickFile`, dynamic imports, and the live kernel worker; a faithful unit test would be almost entirely mocks. Its behaviour is covered by the real-browser e2e in Tasks 6–7 (overlay shows/clears; cancel path). This is the intended verification for this task.

- [ ] **Step 1: Add the new store actions to the destructure**

In `handleOpen` (line ~81), change:

```ts
    const { kernel, setActivePart, setActiveDocument, setStatus, bus } = useAppStore.getState();
    if (!kernel) return;
```
to:
```ts
    const { kernel, setActivePart, setActiveDocument, setStatus, bus, beginFileOpen, endFileOpen } = useAppStore.getState();
    if (!kernel) return;

    let token = -1;
```

- [ ] **Step 2: Begin the open right after the file is picked**

Immediately after `if (!file) return;` (line ~92), add:

```ts
      token = beginFileOpen(file.name);
```

- [ ] **Step 3: Gate the two footer tickers by the token**

In the ZIP branch, change `const stopTicker = startImportTicker(setStatus);` (line ~105) to:

```ts
        const stopTicker = startImportTicker(setStatus, () => useAppStore.getState().fileOpenSeq === token);
```

In the STEP branch, change `const stopTicker = startImportTicker(setStatus);` (line ~131) to:

```ts
        const stopTicker = startImportTicker(setStatus, () => useAppStore.getState().fileOpenSeq === token);
```

- [ ] **Step 4: Add the seq guard to the catch and a clearing finally**

Change the catch block (lines ~187–197) from:

```ts
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const msg = (e as Error).message;
      if (/newer/i.test(msg)) {
        setErrorDialog('This file was saved by a newer ZilInventor. Update to open.');
      } else if (/gzip|corrupt/i.test(msg)) {
        setErrorDialog("Can't open this file — it may be corrupted.");
      } else {
        setErrorDialog(`Open failed: ${msg}`);
      }
    }
  };
```
to:
```ts
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // If this open was cancelled or superseded, the worker was torn down on
      // purpose — swallow the resulting rejection instead of flashing an error.
      if (token !== -1 && useAppStore.getState().fileOpenSeq !== token) return;
      const msg = (e as Error).message;
      if (/newer/i.test(msg)) {
        setErrorDialog('This file was saved by a newer ZilInventor. Update to open.');
      } else if (/gzip|corrupt/i.test(msg)) {
        setErrorDialog("Can't open this file — it may be corrupted.");
      } else {
        setErrorDialog(`Open failed: ${msg}`);
      }
    } finally {
      if (token !== -1) endFileOpen(token);
    }
  };
```

- [ ] **Step 5: Type-check and build the app**

Run: `cd packages/app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run existing FileTab-adjacent unit tests + the new units to confirm no regression**

Run: `cd packages/app && npx vitest run src/store/fileOpen.spec.ts src/import/importTicker.spec.ts src/shell/FileOpenOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/shell/tabs/FileTab.tsx
git commit -m "feat(filetab): drive FileOpenOverlay across all open branches + ticker gate"
```

---

## Task 5: Mount overlay + cancel handler in `App.tsx`

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Import the overlay**

Near the `StatusBar` import (line ~6), add:

```ts
import FileOpenOverlay from './shell/FileOpenOverlay';
```

- [ ] **Step 2: Add the cancel handler**

Immediately after the `handleRestart` `useCallback` ends (line ~1771), add:

```ts
  // Cancel an in-progress File→Open. OCCT parses are one blocking synchronous
  // call, so the only way to actually stop the CPU work is to tear down and
  // respawn the worker — reuse handleRestart, which re-loads the active doc.
  const handleCancelOpen = useCallback(async () => {
    useAppStore.getState().cancelFileOpen();
    await handleRestart();
    if (!unmountedRef.current) useAppStore.getState().setStatus('Open cancelled');
  }, [handleRestart]);
```

- [ ] **Step 3: Render the overlay**

Inside the outer `<div className="flex flex-col h-full">`, right after the `{kernelOffline && ( ... )}` banner block (closes at line ~4277), add:

```tsx
      <FileOpenOverlay onCancel={handleCancelOpen} />
```

- [ ] **Step 4: Type-check**

Run: `cd packages/app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): mount FileOpenOverlay + cancel via kernel restart"
```

---

## Task 6: E2E — overlay shows during open and clears after import

**Files:**
- Create: `tests/e2e/file-open-overlay.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/file-open-overlay.spec.ts`:

```ts
/**
 * E2E: File→Open shows the blocking FileOpenOverlay during the open and
 * removes it once the import completes. The fake file's arrayBuffer() is
 * delayed so the overlay is observably visible (the fixture parses fast).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const STEP = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('file-open overlay appears during open and clears after import', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  const stepBytes = readFileSync(STEP);
  await page.evaluate(
    async ([bytes]: [number[]]) => {
      const fakeFile = {
        name: 'two-bodies.step',
        arrayBuffer: async () => {
          await new Promise((r) => setTimeout(r, 1500));
          return new Uint8Array(bytes).buffer;
        },
      };
      (window as any).showOpenFilePicker = async () => [{ getFile: async () => fakeFile }];
    },
    [Array.from(stepBytes)] as [number[]],
  );

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /open/i }).click();

  const overlay = page.getByTestId('file-open-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('two-bodies.step');

  await page.waitForFunction(
    () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'part',
    undefined,
    { timeout: 60_000 },
  );

  await expect(overlay).toBeHidden();
  const fileOpen = await page.evaluate(
    () => (window as any).__zilventorStore?.getState().fileOpen ?? null,
  );
  expect(fileOpen).toBeNull();
});
```

- [ ] **Step 2: Run the e2e (expect RED first if run before Tasks 4–5 are merged; here it should pass)**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/file-open-overlay.spec.ts`
Expected: PASS — overlay visible mid-open, gone after import, `fileOpen === null`.

> If it fails because the overlay never appears, confirm Tasks 4–5 are in place (overlay mounted in App, `beginFileOpen` called in FileTab).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/file-open-overlay.spec.ts
git commit -m "test(e2e): file-open overlay shows during open and clears after import"
```

---

## Task 7: E2E — Cancel dismisses overlay, restarts kernel, no error

**Files:**
- Create: `tests/e2e/file-open-overlay-cancel.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/file-open-overlay-cancel.spec.ts`:

```ts
/**
 * E2E: Clicking Cancel during an open dismisses the overlay, restarts the
 * kernel worker, shows "Open cancelled", and does NOT pop an error dialog when
 * the abandoned in-flight open later rejects on the dead worker.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const STEP = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('Cancel during open dismisses overlay, restarts kernel, shows no error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  const stepBytes = readFileSync(STEP);
  await page.evaluate(
    async ([bytes]: [number[]]) => {
      const fakeFile = {
        name: 'two-bodies.step',
        arrayBuffer: async () => {
          await new Promise((r) => setTimeout(r, 5000)); // keep the open in-flight
          return new Uint8Array(bytes).buffer;
        },
      };
      (window as any).showOpenFilePicker = async () => [{ getFile: async () => fakeFile }];
    },
    [Array.from(stepBytes)] as [number[]],
  );

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /open/i }).click();

  const overlay = page.getByTestId('file-open-overlay');
  await expect(overlay).toBeVisible();

  await overlay.getByRole('button', { name: /cancel/i }).click();

  await expect(overlay).toBeHidden();
  await waitForKernelReady(page); // kernel worker respawned and ready

  const status = await page.evaluate(
    () => (window as any).__zilventorStore?.getState().statusMessage,
  );
  expect(status).toBe('Open cancelled');

  // Give the abandoned 5s arrayBuffer time to resolve & reject on the dead worker.
  await page.waitForTimeout(5500);
  await expect(page.getByRole('alertdialog', { name: 'Error' })).toHaveCount(0);
  expect(pageErrors).toHaveLength(0);
});
```

- [ ] **Step 2: Run the e2e**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/file-open-overlay-cancel.spec.ts`
Expected: PASS — overlay gone after Cancel, status `Open cancelled`, no error dialog, no page errors.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/file-open-overlay-cancel.spec.ts
git commit -m "test(e2e): cancel during open restarts kernel without error dialog"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the full app unit suite**

Run: `cd packages/app && npx vitest run`
Expected: all green (prior count + ~11 new: 4 store + 2 ticker + 5 overlay).

- [ ] **Step 2: Lint the app package**

Run: `cd packages/app && pnpm lint`
Expected: no new errors. (Note: run lint inside the package, not repo root, to avoid `.worktrees/` false positives.)

- [ ] **Step 3: Run both new e2e specs together**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/file-open-overlay.spec.ts tests/e2e/file-open-overlay-cancel.spec.ts`
Expected: 2 passed.

- [ ] **Step 4: Manual browser proof**

Start the dev server (`pnpm --filter @zilventor/app dev`), open in Chrome, File→Open a real `.step` file, and capture a screenshot showing the overlay (spinner + filename + elapsed + Cancel). Read the screenshot back to confirm it renders. Then let it finish and confirm the overlay disappears. Record the screenshot path in the completion notes.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: file-open overlay verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** blocking modal overlay ✓ (Task 3); all file-open paths ✓ (Task 4 wraps STEP/ZIP/native in one outer try/finally); live elapsed + delayed hint ✓ (Task 3); Cancel via hard restart ✓ (Task 5); footer ticker preserved but no longer fights cancel ✓ (Task 2); error/cancel paths clear overlay ✓ (Task 4 finally + seq guard). No manifest bump ✓ (pure UI/state).
- **Type consistency:** `fileOpen`, `fileOpenSeq`, `beginFileOpen`, `endFileOpen`, `cancelFileOpen` used identically across store (Task 1), FileTab (Task 4), App (Task 5), and tests.
- **Known limitations (from spec, accepted):** Cancel is a hard worker restart (~1–2s OCCT re-init); for an active-assembly STEP-as-component open, restart re-execs only the active part, not assembly components (edge case, not handled here).
