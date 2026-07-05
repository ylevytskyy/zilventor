---
title: Browser Issues
---
# Browser Issues
> Chromium-only features, storage requirements, and what to do when a
> kernel/solver status banner appears.

Zilventor relies on a few browser APIs that aren't universally supported.
Most of the app works anywhere modern, but a handful of features narrow the
field to Chromium-based browsers specifically. See
[Browser Support](../getting-started/browser-support.md) for the general
compatibility baseline.

## Chromium-only features

- **Import from Inventor** requires `showDirectoryPicker` — a File System
  Access API method only Chrome, Edge, Brave, and Arc implement. If the
  button is disabled or errors on click, you're likely on Firefox or Safari;
  switch to a Chromium-based browser for that one workflow.
- **Storage** — Zilventor stores your working documents in the Origin
  Private File System (OPFS). This is required, not optional: without OPFS,
  autosave and session restore have nothing to write to. All current
  Chromium and recent Safari/Firefox releases support OPFS, but if your
  browser is old or running in a locked-down/incognito mode that disables
  origin storage, expect saves to silently fail.

## "Kernel stopped" banner

If the geometry kernel (the WASM OCCT worker) crashes or becomes
unresponsive, a status-bar banner reading **"Kernel stopped — click to
restart"** appears. Clicking it terminates and respawns the kernel worker
and re-applies the active part's feature history in place — you don't need
to reload the page for this. If clicking the banner doesn't resolve it (the
banner reappears immediately, or the app stays unresponsive), reload the
page as a last resort; your work is protected by autosave, so a reload picks
up from the last autosaved state.

## "Sketch solver crashed" banner

If the 2D sketch constraint solver crashes mid-edit, a banner reading
**"Sketch solver crashed — exited sketch mode"** appears and you're dropped
back out of sketch mode. Re-enter the sketch and retry the edit that
triggered it — usually a single bad constraint or an over-constrained
geometry combination. If it crashes again on the same sketch, simplify the
constraints before retrying, or reload the page if the sketch remains
uneditable.

## SolidWorks files aren't importable directly

Zilventor detects `.sldprt` and `.sldasm` files on open and shows a guidance
dialog instead of attempting to import them — SolidWorks' native format
isn't supported. Export the file to STEP from SolidWorks first, then import
the STEP file. See [SolidWorks Files](../import-migration/solidworks-files.md).

## See also

- [Known Limitations](./known-limitations.md)
- [FAQ](./faq.md)
- [Browser Support](../getting-started/browser-support.md)
