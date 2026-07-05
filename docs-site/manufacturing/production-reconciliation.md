---
title: Production Reconciliation
---
# Production Reconciliation
> Scan or type a panel's label QR code to mark it produced, and watch progress against the job tally in real time.

**Where:** Production sub-tab (Browser pane) · **Shortcut:** — · **Applies to:** assembly with printed panel labels

## What it does

The Production sub-tab is where a shop floor checks off physical panels
against the job as they get cut. Each panel copy printed via [Labels and
QR](./labels-and-qr.md) carries a QR code; scanning or typing that code here
looks it up against the current cut list and, if it matches, marks that
specific copy **Produced**. A running count ("*produced* / *total* produced")
tracks progress for the whole job, and a table below lists every physical
copy with its current status.

Two ways to identify a panel:

- **Scan QR code** — opens the device's rear camera and decodes a QR code
  live from the video feed.
- **Enter panel code** — type (or paste) the same `Z|item|copy/qty|LxWxT|materialName`
  string by hand and click **Submit Code**.

Both paths run the same matching logic, so a code that fails one way fails
the other too.

## Before you start

- Print labels first — see [Labels and QR](./labels-and-qr.md). Every code
  scanned or typed here is checked against the cut list that generated those
  labels.
- If using the camera, grant the browser camera permission when prompted —
  scanning is disabled with no prompt if the browser has no camera API at
  all.

## Steps

1. Open the **Production** sub-tab (or click **Open Production** on the
   Furniture ▸ Production ribbon panel).
2. Click **Scan QR code** and point the camera at a panel's printed label, or
   type the code into **Enter panel code** and click **Submit Code**.
3. Read the feedback message — success marks the panel produced; a mismatch
   or duplicate tells you why nothing changed.
4. Repeat for each panel as it's cut. Toggle **Mark produced** / **Mark not
   produced** directly in the table if you need to correct a status without
   rescanning.

*Result: the matched copy's row flips to Produced, and the "*n* / *total*
produced" counter updates.*

## Options

| Control | Meaning |
|---|---|
| Scan QR code | Opens the rear camera and decodes QR codes live from the video feed. |
| Enter panel code | Manual text field for the same QR payload string, for when scanning isn't practical. |
| Submit Code | Validates and applies the typed code, same as a successful scan. |
| Mark produced / Mark not produced | Per-row toggle button — flips a copy's status directly, undoable. |
| Progress line | "*produced* / *total* produced" — a plain count, not a percentage or bar. |

## Tips & gotchas

- **There is no separate "packed" status.** Production tracking here is
  binary — Produced or Not produced — per physical copy. "Packing" only shows
  up downstream as the Produced/Remaining columns on the [Packing
  Slip](./packing-slip.md); there's no additional "packed" state to set here.
- **A code has to match exactly, not just the item number.** If the item
  number matches but the size or material encoded in the code doesn't match
  what's on file (for example, the cut list changed after labels were
  printed), the app reports a mismatch instead of silently accepting it —
  reprint labels after a cut-list change rather than reusing old ones.
- **Scanning the same copy twice is caught.** A code for a copy already
  marked Produced reports "already marked produced" rather than double-
  counting it.
- **The camera scan path has not been smoke-tested on a real mobile
  device.** It's covered by unit tests (a synthetic encode → rasterize →
  decode round trip) and the manual-entry path has end-to-end test coverage,
  but the live-camera path itself — `BarcodeDetector` where the browser
  supports it, a `jsQR`-based frame-polling fallback otherwise — has only run
  in development so far. If you're rolling this out to a phone or tablet on
  the shop floor, treat the first real session as a trial run and have manual
  entry ready as a fallback.

## See also

- [Labels and QR](./labels-and-qr.md)
- [Packing Slip](./packing-slip.md)

<!-- SCREENSHOT: Production sub-tab with the Scan QR code / Enter panel code controls and the per-copy status table — TODO follow-up -->
<!-- SCREENSHOT: successful scan feedback message and the progress counter incrementing — TODO follow-up -->
