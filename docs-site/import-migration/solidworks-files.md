---
title: SolidWorks Files
---
# SolidWorks Files
> Opening a SolidWorks file doesn't fail silently — zilventor recognizes it and tells you to
> export STEP first, because it can't read the native format at all.

**Where:** File tab ▸ **Open…** · **Shortcut:** — · **Applies to:** part, assembly

## What it does

SolidWorks native files (`.sldprt` / `.sldasm`) are proprietary OLE compound documents wrapping
Parasolid geometry. Zilventor's OCCT-based kernel can't read them, and there's no robust
open-source reader for the format in the browser. Rather than fail with a confusing archive
error, **File ▸ Open** detects the `.sldprt`/`.sldasm` extension up front and shows a guidance
dialog instead of attempting the import. Zilventor never attempts a native SolidWorks import —
this is by design, not a missing feature.

## Before you start

- Have SolidWorks available to re-export the file — zilventor can't convert it for you.

## Steps

1. **File** tab ▸ **Open…**, and pick a `.sldprt` or `.sldasm` file.
2. Zilventor shows: *"SolidWorks files (.SLDPRT / .SLDASM) use a proprietary format and can't be
   opened directly. In SolidWorks: File → Save As → Save as type: STEP AP242 (*.step) → Save,
   then open the .step file here."*
3. In SolidWorks: **File ▸ Save As** ▸ set **Save as type** to **STEP AP242 (\*.step)** ▸
   **Save**.
4. Back in zilventor, **File ▸ Open…** and pick the exported `.step` file — see
   [STEP Files](./step-files.md) for what happens next.

## Tips & gotchas

- This applies to both parts (`.sldprt`) and assemblies (`.sldasm`) — either extension triggers
  the same guidance dialog.
- STEP AP242 is the recommended export option because it's the most complete of SolidWorks'
  STEP variants; AP214 also works if AP242 isn't available in your SolidWorks version.
- Everything that applies to a normal STEP import — read-only geometry, the 50 MB size cap, the
  option to Explode a multi-body export — applies here too, since by the time zilventor sees the
  file it's just STEP.

<!-- SCREENSHOT: the SolidWorks guidance dialog shown after picking a .sldprt file — TODO follow-up -->

## See also

- [Import & Migration overview](./index.md)
- [STEP Files](./step-files.md)
- [Inventor Migration](./inventor-migration.md)
