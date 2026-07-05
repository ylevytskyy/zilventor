---
title: Your First Project
---
# Your First Project
> A single walkthrough that takes a blank Zilventor session all the way to a printed shop-label sheet, so you can see the whole design-to-manufacturing pipeline work end to end.

**Where:** File tab, Furniture tab · **Shortcut:** — · **Applies to:** assembly

## What it does

This page walks a brand-new user through one complete pass of the Zilventor pipeline: start a new
assembly, drop in a cabinet, generate its hardware bores, nest its panels onto sheet stock, and
export a printable label sheet for the shop floor. Each step touches a different part of the app —
modeling, furniture, drilling/boring, and manufacturing output — and links to the detailed page
that covers that feature in full. Treat this as a tour, not a reference: once you've done it once,
come back to the linked pages for the options you skipped.

## Before you start

- No prior file needed — this walkthrough creates a brand-new assembly from scratch.
- Have Zilventor open in a supported browser. See [Browser Support](./browser-support.md) if
  you're not sure yours qualifies.
- Skim the [Interface Tour](./interface-tour.md) first so you know where the ribbon and the
  browser pane are — the steps below assume you can find both.

## Steps

1. **New Assembly** — under the **File** ribbon tab, click **New Assembly** to start a blank
   assembly document. An assembly is the document kind that holds cabinets, panels, and
   hardware together. See [Documents and Kinds](../concepts/documents-and-kinds.md) and
   [Saving and Sessions](../concepts/saving-and-sessions.md) for what that means and how it's
   persisted.
2. **Base Cabinet** — switch to the **Furniture** ribbon tab and click **Base Cabinet** in the
   **Cabinets** panel. A dialog titled "Base Cabinet" opens; set the width, height, and depth
   you want and confirm. See [Cabinets](../furniture/cabinets.md) for all the sizing options.
3. **Генерувати присадку** — in the **Furniture ▸ Присадка** ribbon panel, click **Генерувати
   присадку**. Присадка is the Ukrainian cabinetmaking term for the hardware-boring map a panel
   needs; this button auto-generates the confirmat/minifix/dowel joint bores your cabinet's
   panels need so the carcass can actually be screwed together. See
   [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md) for what it
   detects, and [Присадка overview](../drilling-prisadka/index.md) for the toolset as a whole.
4. **Generate Nest** — still in the Furniture ribbon, click **Generate Nest**. A dialog titled
   "Generate Nest" opens; confirm the sheet size and material, then run it to lay out every
   panel in your assembly onto cuttable sheet stock. See [Nesting](../manufacturing/nesting.md)
   for sheet selection and layout options.
5. **Export Labels (PDF)** — click **Export Labels (PDF)** to produce a per-panel shop-label
   sheet (with QR codes) for the parts you just nested. See
   [Labels and QR](../manufacturing/labels-and-qr.md) for label content and template options.

*Result: you now have a modeled cabinet, bored for its hardware, nested onto sheet stock, with a
printable shop-label PDF ready to send to the floor.*

## Options

This walkthrough uses each dialog's defaults; see the linked page for each stage's own Options
table.

| Stage | Options live at |
|---|---|
| Base Cabinet sizing | [Cabinets](../furniture/cabinets.md) |
| Присадка bore parameters | [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md) |
| Nest sheet/material settings | [Nesting](../manufacturing/nesting.md) |
| Label content/template | [Labels and QR](../manufacturing/labels-and-qr.md) |

## Tips & gotchas

- This is the happy path with default dialog values throughout. A real project will want to
  check machining presets, System-32 shelf-pin spacing, and edge-banding before nesting — none
  of that is covered here.
- **Генерувати присадку** only picks up panels created by a cabinet template, because it relies
  on the `role` tag those templates set on each panel. A hand-built custom panel with no role
  won't be bored automatically — see [Присадка overview](../drilling-prisadka/index.md) for the
  convention.
- Run Присадка **before** Generate Nest — the nest lays out whatever panels exist at the moment
  you run it, so bores added afterward won't show up on labels or the DXF cut file without
  re-nesting.
- "Export Labels (PDF)" produces the shop-label sheet only. The cutting file itself is a
  separate button, **Export DXF (Nest)** — don't confuse the two when handing files to the shop.

<!-- SCREENSHOT: the finished nested sheet layout side by side with the exported label PDF — TODO follow-up -->

## See also

- [Interface Tour](./interface-tour.md)
- [Furniture overview](../furniture/index.md)
- [Присадка overview](../drilling-prisadka/index.md)
- [Manufacturing overview](../manufacturing/index.md)
