---
title: Known Limitations
---
# Known Limitations
> Features that are dead, partial, or intentionally scoped down in the current
> build — check here before assuming something is a bug.

This is an honest list of gaps we know about. Some are dead controls that
should be removed or wired up; others are deliberate v1 scope cuts that will
widen later. None of them are secret — they're recorded here so you don't
waste time re-discovering them.

## View tab's Fit (F) and Home buttons don't do anything

The **Fit** and **Home** buttons in the View tab have no click handler — they
render, but clicking them has no effect. There is currently no other way to
re-frame the camera on the model either: no keyboard shortcut and no
context-menu entry trigger a manual "fit to view." The only camera-fit logic
in the app runs once, automatically, when a file is opened or a session is
restored — after that, you're on your own with mouse orbit/pan/zoom.

**Workaround:** use the mouse (scroll to zoom, drag to orbit/pan) to reframe
the model manually. If the model is lost off-screen, reopening the file
re-triggers the automatic fit-on-open.

## Some Присадка ribbon labels render in Ukrainian in the English UI

Two ribbon buttons on the Furniture tab — **Generate Carcass Boring**'s
Присадка group — show Ukrainian text (`Генерувати присадку`, `Очистити
присадку`) even when the app language is set to English. This isn't a
missing-translation fallback; it's bad data — the English locale file itself
has Ukrainian strings recorded under those keys, and the app renders them
correctly according to a broken translation table. Functionally the buttons
work fine; only the label text is wrong.

## No manual carcass-boring picker in the UI

The command layer has an `AddManualJointBoresCommand` for boring a single,
user-picked joint, but no ribbon button, menu item, or context-menu entry
constructs or dispatches it — it's only exercised by its own unit test. In
practice, carcass boring today is all-or-nothing via **Generate Carcass
Boring**; there is no supported way to add or re-drill one joint's bores by
hand.

## Add Handles only bores drawer fronts

**Add Handles** walks a cabinet's drawer fronts and adds a pull plus mounting
bores to each one — there is no door-handle path. Doors get no pull and no
bores from this command. See [Handles and Pulls](../drilling-prisadka/handles-and-pulls.md)
for the full behavior.

## Simple Boring CSV/DXF exports don't carry machining-preset metadata

The plain per-hole **Boring CSV** and **Boring DXF** exports carry geometry
only (panel, position, diameter, depth, face, type) — no tool number or
spindle speed. Only the **Manufacturing DXF** export embeds that CAM
metadata (as DXF XDATA on each bore entity), sourced from whatever
[machining preset](../drilling-prisadka/machining-presets.md) is assigned. If
you need tool/speed data for a CNC post-processor, export the Manufacturing
DXF, not the simple boring CSV/DXF. See
[CAM Metadata](../manufacturing/cam-metadata.md) and
[Manufacturing DXF](../manufacturing/manufacturing-dxf.md).

## Convert-to-Panel (v1) doesn't preserve 3D position

Converting an imported part to a native panel replaces its feature tree with
a flat panel feature, but doesn't correct the panel's placement — the result
recenters to the local origin instead of keeping the original 3D position.
This is a deliberate v1 scope cut, not a bug: dimensions, nesting, DXF
export, labels, and statistics all read from the panel feature (never from
world position), so the only visible effect is a one-time viewport jump after
conversion. See [Convert to Panel](../import-migration/convert-to-panel.md).

## Configurations (iParts) are part-level only, import-only, no inline edit

The configuration table (parameter-driven part variants) is scoped to a
single part document — there's no assembly-level configuration table. You
can import a configuration table from CSV, but there's no export back to
CSV, and rows in the table are click-to-activate only — there's no inline
editing of a cell's value from the table itself. See
[Parameters and Configurations](../concepts/parameters-and-configurations.md).

## Native CAM formats (CIX / MPR / XNC) are not supported

Direct CNC-native formats like CIX, MPR, and XNC are deferred — DXF is the
current manufacturing output format for both per-panel and nested-sheet
exports. If your CNC controller needs one of those native formats, you'll
need to convert from the exported DXF using your machine's tooling.

## Manufacturing DXF hasn't been confirmed to open cleanly in a specific CAD app

The manufacturing/exported DXF is written to the R12 ASCII DXF spec and
passes the app's own reader round-trip, but opening it in a specific external
CAD/CAM package (e.g. AutoCAD) hasn't been independently verified in this
development environment — treat it as untested on that front until you've
confirmed it opens cleanly on your own machine.

## Production camera QR-scan path hasn't been tested on a real mobile device

The Production tab's camera-based QR reconciliation (scanning a panel's QR
code with a phone camera via `BarcodeDetector`/jsQR) has been built and unit
tested, but the live camera path has not been smoke-tested on a real mobile
device. If scanning misbehaves on your phone/tablet, fall back to manual
lookup in the Production tab. See
[Production Reconciliation](../manufacturing/production-reconciliation.md).

## Imported STEP/Inventor parts are effectively frozen

A part imported from STEP (including via the Inventor migration path) is
stored as a single opaque imported-geometry feature — there's no feature-edit
path for it in the current build. You can use it as-is, explode it into
component bodies, or convert it to a native panel (see above); you can't
edit its geometry as a parametric feature. See
[Inventor Migration](../import-migration/inventor-migration.md) and
[STEP Files](../import-migration/step-files.md).

## See also

- [Browser Issues](./browser-issues.md)
- [FAQ](./faq.md)
