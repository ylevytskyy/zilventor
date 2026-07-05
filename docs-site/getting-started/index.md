---
title: Getting Started
---
# Getting Started

> Zilventor is a browser-based furniture & cabinet CAD application that takes a design all the
> way to shop-floor output — this manual is for anyone setting it up or learning it for the
> first time.

## What is Zilventor

Zilventor is a CAD application that runs entirely in the browser: parts, assemblies, and
drawings are modeled, edited, and stored client-side (in the browser's own OPFS storage), with
no server round-trip needed for the modeling work itself. On top of general 3D modeling —
sketches, features, assemblies, drawings — it carries a furniture-specific layer: cabinets,
doors, drawer banks, face frames, and hardware, plus the machining data (carcass and shelf-pin
boring, grooves, keyholes, joinery) that a cabinet shop calls **Присадка**.

The manual follows the pipeline all the way through: from a 3D design, to a nested cut sheet,
to drilling maps, DXF files, and printed shop labels with QR codes.

## Who this is for

This manual is written for cabinetmakers and furniture shops who need to go from a 3D design to
actual shop floor output — cut sheets, drilling maps, labels — not just a render. If you're
coming from a general-purpose CAD tool, the sections that will feel new are
[Furniture](../furniture/index.md), [Drilling / Присадка](../drilling-prisadka/index.md), and
[Manufacturing](../manufacturing/index.md); those three exist because Zilventor treats
"ready to cut and drill" as a first-class output, not an afterthought.

## In this section

| Page | What it covers |
|---|---|
| [Browser Support](./browser-support.md) | Which browsers and versions Zilventor runs on |
| [Interface Tour](./interface-tour.md) | A walkthrough of the app's ribbon, viewport, and panels |
| [Your First Project](./your-first-project.md) | A guided walkthrough from a blank document to a finished part |

## Map of the manual

| Section | Covers |
|---|---|
| [Concepts](../concepts/index.md) | Documents and their kinds, materials, parameters and configurations, saving and sessions, and the browser tree |
| [Modeling](../modeling/index.md) | Sketching, constraints, dimensions, and the extrude/revolve/sweep and modify feature set |
| [Assemblies](../assemblies/index.md) | Placing components, assembly constraints, patterns and mirroring, bill of materials, and interference checking |
| [Furniture](../furniture/index.md) | Panels, cabinets, doors, drawer banks, face frames, hardware, cut lists, and cost/statistics |
| [Drilling / Присадка](../drilling-prisadka/index.md) | Carcass boring, System-32 shelf pins, grooves, keyhole slots, and mortise-and-tenon joinery |
| [Drawings](../drawings/index.md) | Sheets, views, dimensions, annotations, and drawing export |
| [Manufacturing](../manufacturing/index.md) | Nesting, DXF export, shop labels and QR codes, cost reporting, and production reconciliation |
| [Import & Migration](../import-migration/index.md) | Importing STEP and DXF files, ABF flatten import, and migrating from Inventor or SolidWorks |
| [Reference](../reference/index.md) | Keyboard shortcuts, file formats, and a glossary of terms |
| [Troubleshooting](../troubleshooting/index.md) | Known limitations, browser issues, and frequently asked questions |

![Zilventor app window on first launch, showing the ribbon, viewport, and browser tree](/img/getting-started/app-window.png)
