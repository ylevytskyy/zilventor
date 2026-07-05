---
title: Glossary
---
# Glossary
> Furniture-CAD and app-specific terms, defined the way this app actually uses them — not just the general woodworking sense.

### ABF

A third-party SketchUp plugin ("ABF Extension") used for CNC-driven panel-furniture production; the acronym itself is never expanded in the plugin's own docs. Zilventor's Manufacturing DXF export offers an "ABF" layer scheme (alongside "Native") that names layers to match ABF's conventions, for shops whose downstream CAM workflow expects ABF-style output. See [ABF Layer Scheme](../manufacturing/abf-layer-scheme.md).

### BOM (Bill of Materials)

The aggregated parts list for an assembly: component instances are grouped by part and effective color, each group gets a stable item number, and the BOM records quantity, part name, and (if set) part number and description. See [Bill of Materials](../assemblies/bill-of-materials.md).

### Confirmat

A cross-panel screw connector. Zilventor bores it as a matched pair: a Ø7mm through-bore on the face side of one panel, and a Ø5mm bore into the mating panel's edge (depth = 50mm screw length minus the face-side panel's thickness). See [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md).

### Dowel

A plain glue-dowel joint. Bored as a Ø8mm × 12mm socket in the face-side panel and a Ø8mm × 13mm socket (clamped to board thickness) in the mating panel's edge. See [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md).

### DXF (Drawing Exchange Format)

AutoCAD's 2D vector interchange format. Used throughout the app for drawing export, manufacturing/nesting export, and DXF import. See [Export Formats](./export-formats.md) and [DXF Files](../import-migration/dxf-files.md).

### Edge-banding

Tape or strip material applied to a cut panel's edge to hide the substrate. Modeled per edge (front/back/left/right), each with its own material and thickness; a panel's gross (cut) size adds the banded edges' thicknesses on top of its net (finished) size. See [Panels](../furniture/panels.md).

### Face vocabulary (Top / Bottom / Front / Back / Left / Right)

The six named faces of a panel. **Top** and **Bottom** are the two large faces — the ones whose normal runs along the panel's thickness axis. **Front**, **Back**, **Left**, and **Right** are the narrow edge faces, no wider than the board thickness, and have no flat 2D/DXF representation of their own. Bores, grooves, and other machining features are always placed relative to one of these six named faces. See [Drilling / Присадка](../drilling-prisadka/index.md).

### Grain direction

A per-panel setting — length, width, or none — that constrains which orientation the panel is allowed to nest in. A grain-locked panel is only tried in the orientation matching its grain; if it doesn't fit that way but *would* fit rotated, nesting excludes it with the reason "grain-locked exceeds sheet" rather than the generic "panel exceeds sheet," so you can tell the two failure causes apart. See [Nesting](../manufacturing/nesting.md).

### Guillotine nest

The nesting algorithm's cut style: every split of sheet space produces two sub-rectangles that each span the full remaining width or height, so every resulting cut runs straight, edge to edge — the kind of cut a panel saw can make in one pass. No L-shaped or partial cuts are ever produced. See [Nesting](../manufacturing/nesting.md).

### iPart / Configuration

A named, saved set of parameter values on a part — analogous to Autodesk Inventor's iParts. Activating a configuration bulk-sets the part's parameters to that saved set, letting one part definition produce several named variants. See [Parameters and Configurations](../concepts/parameters-and-configurations.md).

### Kerf

The saw blade or router bit's width. Added as a spacing gap between adjacent panels during nesting, so the layout accounts for material actually lost to the cut, not just panel-to-panel contact. See [Nesting](../manufacturing/nesting.md).

### Minifix

A cam-and-bolt connector. Bored as a Ø15mm cam-housing bore plus a Ø8mm cross-bore into the cam on one panel's face, and a separate Ø8mm bolt bore into the mating panel's edge. See [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md).

### OPFS

Origin Private File System — the browser's private, sandboxed local file storage, and the backend Zilventor uses for every project file, hardware SKU, and template during a session. Nothing leaves the browser unless you explicitly export or save it elsewhere. See [Saving and Sessions](../concepts/saving-and-sessions.md).

### Overlay

A door or drawer front's mounting style relative to the cabinet opening. Full and half overlay sit the front proud of the cabinet face; inset sits it flush inside the opening. Overlay type also changes the hinge cup's setback distance. See [Doors](../furniture/doors.md).

### Oversize

A per-cut length/width allowance added on top of a panel's net (finished) size before nesting — for example, to leave a trim margin for post-machining finishing. This is separate from the gross size added by [edge-banding](#edge-banding). See [Nesting](../manufacturing/nesting.md) and [Cut List](../furniture/cut-list.md).

### Присадка (Prisadka)

The umbrella term — and ribbon tab — for the app's hardware-boring and machining tools: carcass connector bores, System-32 shelf pins, hinge cups, grooves and dados, keyhole slots, mortise-and-tenon joinery, handle bores, and leg levelers. See [Drilling / Присадка](../drilling-prisadka/index.md).

### Remnant

The single largest leftover free rectangle (at least 100mm on each side) on a nested sheet. Zilventor labels it on export so it can be tracked as reusable stock, but it does not track smaller offcuts at all — only the one largest remnant per sheet. See [Nesting](../manufacturing/nesting.md).

### Reveal

The gap left around an overlay door's edge relative to the cabinet opening (default 2mm). Inset doors use an equivalent "clearance" value instead, and a double-door opening uses a separate "center reveal" (default 3mm) for the gap between the two doors. See [Doors](../furniture/doors.md).

### STEP (Standard for the Exchange of Product Data)

The ISO 10303 3D interchange format. Used for importing and exporting solid geometry through the app's OCCT-based kernel. See [Export Formats](./export-formats.md) and [STEP Files](../import-migration/step-files.md).

### System-32

The shop-standard Ø5mm, 32mm-pitch line-boring layout: blind holes drilled into a cabinet side panel's inner face so adjustable shelf-support pins can seat at any 32mm increment. See [System-32 Shelf Pins](../drilling-prisadka/system-32-shelf-pins.md).

### Toekick

The recessed base panel at the bottom-front of a base cabinet. Wall and upper cabinets have zero toekick height. Leg levelers are typically fitted behind the toekick, out of sight. See [Leg Levelers](../drilling-prisadka/leg-levelers.md) and [Cabinets](../furniture/cabinets.md).

## See also

- [File Formats](./file-formats.md)
- [Export Formats](./export-formats.md)
- [Drilling / Присадка](../drilling-prisadka/index.md)
- [Manufacturing](../manufacturing/index.md)
