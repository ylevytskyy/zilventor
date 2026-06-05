# Open `.SLDPRT` / `.SLDASM` files — detect and guide to STEP

**Date:** 2026-06-05
**Status:** Approved (brainstorming)

## Problem

Users (a furniture-CAD team) receive SolidWorks native files (`.SLDPRT` parts,
`.SLDASM` assemblies) from suppliers and want to open them in ZilInventor.

## Feasibility constraint (the crux)

`.SLDPRT` / `.SLDASM` are **proprietary OLE compound files wrapping Parasolid
geometry** (SolidWorks is built on Siemens' Parasolid kernel).

- The OCCT WASM kernel **cannot read** these formats — only STEP/IGES/BREP/STL.
- There is **no robust open-source library** that reads native SolidWorks
  geometry, and the partial efforts (FreeCAD plugins) run natively, not in a
  browser/WASM context.
- The only reliably in-browser-extractable data is a thumbnail image and
  *sometimes* an undocumented, version-dependent tessellated preview mesh —
  reverse-engineering it is a fragile research project yielding a display-only
  mesh (no faces, features, editability, or drawings).

Therefore **importing real geometry from SolidWorks native files is not
achievable** in this app with open-source tooling.

## Decision

Rather than fail with a cryptic archive error, **detect** `.SLDPRT`/`.SLDASM` in
**File → Open** and show a **clear guidance dialog** that explains the limitation
and tells the user how to export a STEP from SolidWorks — which the app already
imports robustly via the existing STEP pipeline.

(Alternatives considered and rejected: best-effort mesh extraction — fragile,
mostly fails; cloud conversion API — outward-facing, paid, sends proprietary
files off-machine; thumbnail-only — not usable CAD.)

## Implementation

All changes in `packages/app/src/shell/tabs/FileTab.tsx` plus one tiny helper.

1. **File picker accept list** (`pickFile`, ~line 90): add a
   `SolidWorks file → .sldprt, .sldasm` entry so the files are selectable.

2. **Early-return branch in `handleOpen`**, placed right after `if (!file) return;`
   and **before** `beginFileOpen` (nothing is loading, so no import overlay /
   ticker): if `isSolidWorksNativeFile(file.name)`, call
   `setErrorDialog(SOLIDWORKS_GUIDANCE)` and return.

3. **New helper** `packages/app/src/import/solidworksGuidance.ts`:
   - `isSolidWorksNativeFile(name: string): boolean` — matches
     `/\.(sldprt|sldasm)$/i`.
   - `SOLIDWORKS_GUIDANCE` — exported message constant so the wording is stable
     and unit-testable.

4. **Reuse** the existing `errorDialog` modal (FileTab.tsx) — no new component.

### Guidance text

> SolidWorks files (.SLDPRT / .SLDASM) use a proprietary format and can't be
> opened directly. In SolidWorks: File → Save As → Save as type: STEP AP242
> (*.step) → Save, then open the .step file here.

## Out of scope

- Any geometry / mesh / thumbnail extraction.
- `.SLDPRT` *inside* a `.zip` (the existing "No STEP found in archive" message
  already covers that acceptably).

## Testing

- **Unit (TDD)** `solidworksGuidance.spec.ts`: `isSolidWorksNativeFile` true for
  `.sldprt`/`.sldasm` (mixed case), false for `.step`/`.zipt`/`.ziasm`/`.zip`/no-ext;
  `SOLIDWORKS_GUIDANCE` contains "STEP".
- **Browser verify (Playwright):** drive the `handleOpen` SolidWorks branch and
  confirm the guidance dialog renders.
