---
title: Browser Support
---
# Browser Support
> Which browsers Zilventor runs in, and which specific features need a Chromium-family browser.

**Applies to:** all documents

## What it does

Zilventor is a browser-based CAD tool with no server-side document storage — it needs two
browser features to run at all: **Origin Private File System (OPFS)** storage and **module Web
Workers**. It also needs to be served over **HTTPS or localhost**. If any of these are missing,
Zilventor shows a "Browser not supported" splash screen instead of loading, with this text:

> "ZilInventor requires features that are not available in your current browser: Origin Private
> File System (OPFS) storage and module Web Workers."

<!-- SCREENSHOT: the "Browser not supported" splash screen shown when OPFS or module Web Workers are missing — TODO follow-up -->

## Supported browsers

| Browser | Minimum version |
|---|---|
| Google Chrome | 86+ |
| Microsoft Edge | 86+ |
| Mozilla Firefox | 111+ |

**Safari is not supported.** It isn't listed on the supported-browsers splash, and Zilventor
does not run in it.

## Feature availability

Most of Zilventor works identically across all three supported browsers. One feature is
Chromium-only:

| Feature | Works in |
|---|---|
| New / Open / Save / Save As | All supported browsers (Chrome, Edge, Firefox) — uses the File System Access API where available, and falls back to a plain file picker / download automatically where it isn't |
| Import from Inventor | Chromium-family browsers only (Chrome, Edge, Brave, Arc) |

Import from Inventor needs to walk an entire exported-project directory tree at once, which
requires `showDirectoryPicker` — a Chromium-only browser API. In browsers without it (Firefox),
the **Import from Inventor** item is simply disabled. Its tooltip reads:

> "Import from Inventor requires Chrome, Edge, Brave, or Arc (uses showDirectoryPicker)."

Ordinary document work — creating, opening, and saving files — is **not** limited to
Chromium: it works the same way in every browser listed above.

## Tips & gotchas

- **Safari is unsupported, not just untested** — don't expect any part of Zilventor to work
  there.
- **HTTPS or localhost is required.** Zilventor won't run when served over plain HTTP on a
  non-localhost address.
- **SolidWorks files (.SLDPRT / .SLDASM) can't be opened in any browser** — this is a file
  format limitation, not a browser one. Opening one shows:

  > "SolidWorks files (.SLDPRT / .SLDASM) use a proprietary format and can't be opened
  > directly. In SolidWorks: File → Save As → Save as type: STEP AP242 (*.step) → Save, then
  > open the .step file here."

  See [SolidWorks Files](../import-migration/solidworks-files.md) for the conversion workflow.

## See also

- [Inventor Migration](../import-migration/inventor-migration.md)
- [SolidWorks Files](../import-migration/solidworks-files.md)
- [STEP Files](../import-migration/step-files.md)
