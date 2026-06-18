# ZilInventor — Gap Report: Features Missing for an "Inventor 2012 for Furniture" MVP

**Date:** 2026-06-18
**Branch analyzed:** `master` @ `2a86ba63`
**Method:** Fan-out of 6 parallel domain analysts (one per Inventor 2012 feature area), each comparing the shipped codebase against the corresponding Inventor 2012 capability set, scored for furniture relevance. Evidence is primarily file/type/command inventory + CAD domain knowledge; per-dimension analyst confidence ran 78–82/100 (see caveats at end).

---

## Executive summary

The product is already **far past a toy** — it has a constraint-solved 2D sketcher, 10 history-based part features on a real OCCT kernel, assemblies with mates/patterns/BOM/interference, a full drawing module with DXF/PDF output, and a genuine first-generation furniture stack (cabinets, doors, drawers, Система-32 boring, face frames, cut-list, nesting). ~4,700 tests, typecheck-clean, deployable.

The MVP gap is **not** in generic CAD breadth — it is concentrated in **two places**:

1. **Furniture production output & construction breadth** — the things a real furniture maker needs to actually *make* the work: CNC-ready output, wall/tall/corner cabinet types, framed door styles, true joinery (dado/rabbet/groove), 32mm discipline, kerf/oversize in cut-list.
2. **Parametric automation (iLogic / iPart families)** — the configurator layer that makes "Inventor *for furniture*" a product rather than a drafting tool.

Everything else (sketch/part/assembly/drawing gaps) is mostly **SHOULD-HAVE polish** with workarounds.

---

## Cross-cutting MUST-HAVE list (the real MVP blockers)

Ranked by how hard they block a furniture maker shipping work:

| # | Gap | Dimension | Why it blocks MVP |
|---|-----|-----------|-------------------|
| 1 | **CNC-ready output (CIX / G-code / DSTV)** | Furniture | DXF boring map is human-readable, not machine-loadable. Without this the output is a printout, not a production file for Biesse/Homag/SCM. |
| 2 | **Dado / rabbet / groove cut feature** | Part + Furniture | Core cabinetry joinery. Current присадка is point-bores only — shelf housings, back-panel capture, drawer-bottom grooves cannot be modeled. |
| 3 | **Wall & tall cabinet types** | Furniture | Only base cabinets exist. Can't lay out a kitchen/wardrobe without uppers and tall units. |
| 4 | **Corner cabinet handling** | Furniture | L/blind/diagonal corner. Nearly every kitchen needs one. |
| 5 | **iLogic-style rule engine** | Automation | The mechanism that reconfigures a cabinet when a parameter changes — the heart of "for furniture" as a configurator product. |
| 6 | **iPart / design-table families** | Automation | Table-driven variants for hardware SKUs and cabinet size families. |
| 7 | **Framed door/drawer-front styles (shaker / raised-panel)** | Furniture | Only slab fronts. Limits the product to flat-pack/Ikea-style work. |
| 8 | **32mm system snap grid** | Furniture | Euro-cabinet boring must snap to the 32mm pitch for interchangeable hardware/shelf spacing. |
| 9 | **Kerf + oversize allowance in cut-list/nesting** | Furniture | No saw-kerf between nested parts and no per-panel oversize → undersized panels & optimistic yield. |
| 10 | **Balloons tied to BOM item numbers** | Drawings | Parts list exists but no bubble callouts on views — core for shop-floor assembly drawings. |
| 11 | **Insert + tangent/coaxial assembly constraints** | Assembly | Cylindrical hardware (dowels, hinges, pins) can't be mated in one pick; only mate/flush/angle exist. |
| 12 | **DWG import/export** | Interop | DWG (not just DXF) is the interchange format architects/CNC vendors expect. |
| 13 | **Live model→drawing associativity** | Drawings | Stale-view detection exists but regen is manual (F5); shops expect auto-update. |
| 14 | **Drawing templates + edge-band geometry** | Drawings + Furniture | No `.zidrw` template (consistent shop output); edge bands are tags only (no thickness/clearance). |

---

## Per-dimension findings

### Sketching
**Implemented:** line/arc/circle/rectangle/spline, 8 geometric constraints (coincident, H/V, parallel, perpendicular, tangent, equal, symmetric), 6 driven dimensions (literal + parameter-bound), trim/extend/offset/fillet/chamfer/project, expression cascade.

- **MUST-HAVE:** sketch-entity **Mirror**; **point-on-curve/line** constraint; **Fix/Ground** constraint; **Collinear** constraint.
- **SHOULD-HAVE:** slot/oblong primitive; polygon; concentric; midpoint; associative project-geometry; arc/full-circle trim; arc extend.
- **NICE-TO-HAVE:** smooth(G2); spline control-point editing; ellipse; sketch text; equation curves.

### Part Modeling
**Implemented:** Extrude (join/cut/symmetric), Revolve, Sweep, Hole (cbore/csink, blind/through/to-face), Fillet (const+variable), Chamfer (symmetric only), Shell, Linear Pattern, Mirror, Work axis/plane/point. Boolean ops exist internally but aren't user-facing.

- **MUST-HAVE:** **Groove/Dado/Rabbet** (shape-removing channel); **user-facing Boolean Combine**; **Extrude to-face/up-to-surface**.
- **SHOULD-HAVE:** extrude taper; two-distance/angle chamfer; Split body/face; Face Draft; multi-body parts; part-level Circular Pattern; threaded hole.
- **NICE-TO-HAVE:** Loft, Rib, Coil, Emboss/Decal, Boss, Derived part, Direct-edit/Move-face.

### Assembly
**Implemented:** nested sub-assemblies, placement, mate/flush/angle constraints (+offset/suppress/edit), rectangular & circular component patterns, mirror, ground & flexible toggles, AABB+DistShapeShape interference, BOM aggregation + renumber, separate hardware-BOM stream.

- **MUST-HAVE:** **Insert** constraint; **tangent/coaxial** constraint; **Replace Component**; **BOM purchased/phantom flags** (unified structured BOM); **positional representations** (run-of-cabinets states).
- **SHOULD-HAVE:** symmetry constraint; DOF/over-constraint reporting; pattern-along-path; copy-as-independent vs instance; BOM revision/vendor/material/mass columns.
- **NICE-TO-HAVE:** drive constraint/animation, contact solver, LOD reps, adaptivity, design-view reps.

### Drawings
**Implemented:** base/projected/section(full/half/stepped)/detail/isometric views, broken views; linear/radial/angular/ordinate/baseline/auto dims; text+leaders; centerlines; hole tables; parts list (renumber/override); editable title block; multi-sheet; stale-view detection; DXF(R12)/PDF/PNG/SVG + boring-DXF export.

- **MUST-HAVE:** **Balloons** (auto/manual, BOM-linked); **live view associativity** (auto-regen); **break-out/local section** view; **drawing templates**.
- **SHOULD-HAVE:** chamfer/countersink dimension notes; ordinate datum lock + jog; revision table/cloud; enforced view alignment; tangent-edge display toggle; custom border editing.
- **NICE-TO-HAVE:** surface-finish symbols; GD&T; weld symbols; named text/dim styles; per-view DXF layer mapping.

### Furniture Workflows *(core differentiator — highest analyst confidence, 82)*
**Implemented:** single base-cabinet type; slab/overlay doors; equal-height drawer banks; Система-32 boring (shelf-pin/slide/hinge-cup/handle/carcass); 3-SKU bar-pull catalog; wood face frames (R×C); cut-list CSV (4 edge-band cols); guillotine nesting (PDF/PNG); boring DXF/CSV. All undoable, real OCCT.

- **MUST-HAVE:** wall & tall cabinets; corner cabinets; **CNC output (CIX/G-code)**; 32mm snap grid; grain-direction edit; edge-band geometry/thickness; framed door/drawer-front styles.
- **SHOULD-HAVE:** fuller hardware catalog (drawer slides, leg levelers, soft-close, Euro hinges); joinery variety (dado/groove/rabbet/pocket-screw/biscuit); cut-list oversize/saw-trim allowance; nesting kerf; label/barcode printing; adjustable-shelf boring configurator UI.
- **NICE-TO-HAVE:** pricing/costing; global frameless↔face-frame construction toggle; per-cabinet shop-drawing PDF; inset-door Y-flush; handles on doors; "duplicate cabinet run" pattern that re-targets boring.

### Interop & Automation & Materials
**Implemented:** STEP import (multi-part) + Inventor JSON import; STEP/STL export (XCAF); DXF/PDF/PNG/SVG; boring/cut-list/BOM CSV; nesting PDF/PNG; parameter/expression engine (`expr-eval`); PBR materials; OPFS autosave + versioned manifest.

- **MUST-HAVE:** **iLogic-style rule engine**; **iPart design-table families**; **iAssembly factories**; **DWG import/export**; parameter spreadsheet round-trip.
- **SHOULD-HAVE:** iProperties/custom metadata; SketchUp **SKP import**; glTF export; 3MF export; Pack-and-Go portability; physical material properties (density for weight).
- **NICE-TO-HAVE:** IGES, SAT/Parasolid, realistic render/lighting, Vault, Design Assistant link repair.

---

## Recommended MVP slicing (suggested, not yet decided)

1. **Furniture production wave** — dado/rabbet/groove feature → wall/tall/corner cabinets → CNC CIX export → 32mm snap → kerf/oversize in cut-list. *(Unblocks "can a shop actually make this.")*
2. **Configurator wave** — iLogic-style rules + iPart/design-table families + framed door styles. *(Makes it "Inventor for furniture", not just CAD.)*
3. **Documentation wave** — balloons + live associativity + drawing templates. *(Shop drawings shops can hand off.)*
4. **Interop wave** — DWG + SKP import. *(Plays in the existing furniture-shop toolchain.)*

---

## Caveats on confidence

- **Evidence basis:** Analysts inventoried command/type/file names and compared to Inventor 2012; they did **not** read every implementation body. "Missing" generally means no command/type/`rg` hit; a feature could exist under a different name. "Implemented" means a file/command exists, not that it is complete or bug-free.
- **Severity is a judgment call** keyed to a **production cabinet/kitchen shop** target. If the target is **one-off custom furniture** (not production kitchens), several MUST-HAVEs soften — most notably CNC output, wall/corner cabinets, and 32mm snap drop toward SHOULD-HAVE, while iLogic/iPart matter less.
- **Per-dimension confidence:** Sketching 78, Part 78, Assembly 78, Drawings 78, Furniture 82, Interop/Automation 82.
- **Highest-leverage verification before committing roadmap:** confirm the intended **target market** (production shop vs. custom one-off), and spot-read the bodies behind the top-5 MUST-HAVEs (CNC output, dado feature, cabinet types, iLogic, balloons) to confirm true absence vs. partial implementation.
