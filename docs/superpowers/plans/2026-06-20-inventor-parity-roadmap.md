# ZilInventor → Inventor 2012 (+ Woodwork) Furniture Parity — Roadmap

**Date:** 2026-06-20
**Status:** Draft for approval. High-level milestones only. Each milestone is decomposed
into managed TDD tasks in its OWN fresh session via a per-milestone handoff (brainstorm →
spec → writing-plans → subagent-driven TDD).

**Source:** 6-dimension parity audit (part modeling, assembly, furniture authoring, drawings,
manufacturing/CAM, automation/interop) + ABF investigation. See conversation audit tables.

## Working model
- This file lists **milestones** (coarse, checkbox-tracked).
- Do **not** decompose every milestone here. When a milestone starts, open a clean context,
  read its handoff, and run brainstorming → writing-plans to produce the task-level slices.
- Order is a recommendation; M1 is fixed-first by user decision.

## ABF clarification (resolved)
"ABF" = the **getabf.net SketchUp plugin**, not a file format. It exports **layered DXF** +
nesting + labels. Therefore there is no `.abf` codec to build; ABF-parity == a manufacturing
DXF/nesting/label output capability set, captured as **M2** (built on M1's DXF stack).

---

## Milestones

- [ ] **M1 — Full-fledged DXF support** *(FIRST — user-priority; handoff written)*
  Bidirectional DXF. Import + export round-trip. All use-cases co-equal (CNC/manufacturing,
  2D drafting interchange, customer/vendor geometry import). **Import lands as editable 2D
  sketch primitives.** Modern AutoCAD target (AC1015 / 2000+) with broad entity coverage
  (LINE, ARC, CIRCLE, LWPOLYLINE/POLYLINE, SPLINE, ELLIPSE, TEXT/MTEXT, INSERT/BLOCK, layers).
  Replaces / unifies the three hand-rolled R12 exporters behind one shared DXF module.
  → Handoff: `docs/superpowers/plans/2026-06-20-dxf-milestone-handoff.md`

- [ ] **M2 — Manufacturing output ("ABF-plugin parity")** *(depends on M1)*
  Layered manufacturing DXF per panel (outline + bores + grooves + edge-band metadata on
  named layers), sheet **nesting DXF** for saws/routers, and **per-panel shop labels**
  (item#, material, L×W×T, grain arrow, edge codes, barcode/QR). Reuses M1 writer + existing
  nesting (`packGuillotine`) + cut-list aggregation. Absorbs manufacturing-audit P0 #2/#3.

- [ ] **M3 — CNC machine post (CIX / Homag)** *(independent)*
  Biesse `.cix` boring/routing post (maps 1:1 to `BoreOp`), optionally Homag MPR/WoodWOP.
  Manufacturing-audit P0 #1. Previously deferred ("need real .cix") — unblock with a real
  sample file.

- [ ] **M4 — Furniture authoring correctness** *(independent)*
  Under-mount slide boring (Blum TANDEM), variable-height drawer banks, toekick leg-leveler
  boring, blind/diagonal corner cabinet, custom hardware SKU import. Furniture-audit P0/P1.

- [ ] **M5 — Assembly motion & representations** *(independent)*
  Positional Representations (door/drawer open↔closed), constraint limits (max/min/resting),
  surface DOF/over-constraint diagnostics in the browser UI. Assembly-audit P0/P1.

- [ ] **M6 — Automation productization** *(independent)*
  In-app rule authoring UI (rules are JSON-only today), string/bool parameter types, iPart
  member-file generation, CSV config round-trip + quoted-comma fix. Automation-audit P0/P1.

- [ ] **M7 — Drawing completeness** *(independent)*
  Centerlines/centermarks for hole patterns, leader/free-text note annotations, verified
  multi-sheet PDF, revision table, multi-level (indented) parts list. Drawing-audit P0/P1.

- [ ] **M8 — Sketch & part-modeling polish** *(independent)*
  Fix/Ground sketch constraint, extrude to-face termination, 2D ellipse, mirror/linear pattern
  across arbitrary work plane/axis. Part-modeling-audit P0/P1.

## Recommended sequencing
The highest-leverage thread is **close-the-loop-to-the-shop-floor: M1 → M2 → M3.**
M4–M8 are independent and can be scheduled by business priority afterward. M1 unblocks M2;
M2/M3 make the tool actually usable by a CNC furniture shop.

## Audit confidence (for context)
Part 72 · Assembly 80 · Furniture 82 · Drawings 72 · Manufacturing 82 · Automation 78 ·
ABF identity 62. Woodwork-for-Inventor baselines lean on training knowledge; a few "partial/
missing" ratings were inferred from command/solver code without reading every panel component.
