# File-Open Loading Overlay — Design

**Date:** 2026-06-05
**Status:** Approved, ready for planning

## Problem

When opening a file there is no obvious visual feedback, so the user cannot tell
whether the app has crashed or is still loading. A STEP import can take minutes
(a 171 MB assembly loads in ~8.75 min), during which the screen appears frozen.

Current state:
- A progress "ticker" exists (`packages/app/src/import/importTicker.ts`) but only
  for STEP/ZIP imports, and only as **plain text in the bottom status bar**
  (`StatusBar.tsx` reading `statusMessage`) — easy to miss.
- Native files (`.zipt` / `.ziasm` / `.zidw`) show **no feedback at all**.
- The kernel runs OCCT (WASM) in a long-lived Web Worker (`KernelClient.ts`,
  spawned at `App.tsx:1018`) via Comlink, so the UI thread is free to render an
  overlay during the parse — it just doesn't today.

## Goal

A prominent, hard-to-miss loading indicator shown for **every** file-open path,
with a working **Cancel** button.

Success criteria:
- Opening any file (STEP/STP, ZIP, `.zipt`, `.ziasm`, `.zidw`) shows a blocking
  modal overlay with a spinner, the file name, and live elapsed time.
- The overlay is dismissed on success, on error, and on cancel.
- Cancel actually stops the in-progress parse (frees CPU) and returns the app to
  a responsive, consistent state.

## Approach

### 1. `FileOpenOverlay` component
A new blocking modal overlay: full-viewport dimmed scrim + centered card. Rendered
only while a file-open is in progress. The scrim catches clicks so no other command
can fire mid-open.

Card contents:
- Animated spinner.
- `Opening <filename>…`
- `M:SS elapsed`, updated every 1s.
- Hint `(large assemblies can take several minutes)` — shown only after ~3s so it
  does not flash for fast native-file opens.
- A **Cancel** button.

### 2. Store state
Add one slice to `useAppStore`:

```ts
fileOpen: { fileName: string; startedAtMs: number } | null
setFileOpen(value): void
```

The overlay is visible iff `fileOpen !== null`. Elapsed time is computed inside the
component via a local 1s `setInterval` from `startedAtMs` — no per-tick store writes.

The existing `statusMessage` / `importTicker` footer text is left untouched (the
status bar keeps working); the overlay is a new, more prominent layer on top.

### 3. Wiring — `FileTab.handleOpen` (`FileTab.tsx`)
For each of the three branches (STEP, ZIP, native):
- Call `setFileOpen({ fileName, startedAtMs: Date.now() })` at the start.
- Wrap the work in `try/finally` so `setFileOpen(null)` always runs — on success,
  on error (existing error dialog still shows), and on cancel.

This closes the gap where native-file opens showed nothing.

### 4. Cancel mechanism
The Cancel button terminates and respawns the kernel worker by **reusing the
existing restart logic** (`handleRestart`, `App.tsx:1730-1771`), which already:
- calls `terminateRef.current?.()` → `worker.terminate()`,
- spawns a fresh worker and re-initializes OCCT,
- re-executes / re-loads the active document.

To avoid duplication, extract a shared `restartKernel()` helper from `handleRestart`
so both the existing restart UI and the overlay's Cancel call the same code.

After restart: clear `fileOpen`, show a brief `"Open cancelled"` status. The in-flight
`kernel.importStep` promise is abandoned (it rejects / never resolves on the dead
worker); guard so a stale late result cannot mutate state after cancel.

**Caveat (accepted):** Cancel is a *hard* worker restart. OCCT gives no mid-parse
yield point (`readStep` in `StepIO.ts` is one blocking synchronous call), so the only
way to actually stop the CPU work is to kill the worker. Cost: ~1–2s to re-instantiate
OCCT WASM plus reloading any already-open document. This is the correct trade for
bailing out of a wrong large-file open, but Cancel briefly reloads the kernel rather
than gracefully stopping just the one parse.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `FileOpenOverlay` | Render the modal; show elapsed time; emit Cancel | `useAppStore.fileOpen`, cancel handler |
| `useAppStore.fileOpen` slice | Hold/clear open-in-progress state | — |
| `FileTab.handleOpen` | Set/clear `fileOpen` around all open branches | store |
| `restartKernel()` helper | Terminate + respawn worker, reload active doc | KernelClient, store |

## Error handling
- Parse error: `finally` clears `fileOpen`; existing error dialog (`FileTab.tsx:215`)
  is unchanged.
- Cancel: hard restart, clear `fileOpen`, status `"Open cancelled"`, stale-result guard.

## Testing
- **Unit:** overlay renders when `fileOpen` set / hidden when null; `M:SS` elapsed
  formatting; hint appears only after ~3s.
- **Unit:** `handleOpen` sets and clears `fileOpen` across all three branches,
  including the error path.
- **E2E:** open a real STEP file → overlay visible during parse → gone after load.
  Cancel-path e2e if feasible: open → Cancel → overlay gone + kernel responsive.

## Out of scope (YAGNI)
- Graceful mid-parse cancellation (impossible without OCCT yield points).
- Determinate progress bar / percentage (OCCT exposes no progress callback here).
- Per-stage progress breakdown.

## No manifest bump
Pure UI/state addition; no persisted-document schema change.
