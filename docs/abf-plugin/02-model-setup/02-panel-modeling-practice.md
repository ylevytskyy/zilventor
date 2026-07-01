# Practical Panel-Modeling Habits

This doc shows the concrete modeling sequence tutorial authors use to produce ABF-compliant panels. It assumes you already know the underlying rule from [The Solid-Group Input Contract](01-solid-group-contract.md) (panels must be true-solid Groups, not Components). Here we cover the day-to-day muscle memory: how a panel actually gets drawn, grouped, sized, and named in a live modeling session.

Source: demonstrated in the tutorial "SketchUP Plugin ABF початок роботи, перші кухонні модулі" (youtube.com/watch?v=aaj2kSkRorI) and corroborated by "ABF - робота з плагіном" (youtube.com/watch?v=uMuSPHSUDf4).

## Step-by-step: sketch → immediate group creation → thickness via push/pull → rename via Outliner/F2

The modeling sequence observed in the tutorials, in order:

1. **Draw a rectangle** on the working plane at the panel's face dimensions (e.g. width × height for a side panel).
2. **Group it immediately** — right-click the rectangle → SketchUp's native "Create Group" ("Создать группу"). This happens before any other edit. The panel is a Group from the moment it exists, never a Component at any point in its life.
3. **Push/Pull to thickness** — enter the group (double-click), select the flat face, and Push/Pull to the panel's material thickness (e.g. 18mm). This extrudes the flat rectangle into a solid box, which is what makes the group a true "Solid" (SketchUp's solid-inspector icon confirms this — see the parent contract doc for what "true solid" means and why it matters).
4. **Rename immediately** — with the group still selected, rename it via the Outliner panel or the F2 keyboard shortcut. Examples observed: `Left`, `цоколь` (toe-kick), `дно` (bottom), `фасад` (facade/front).

This is a tight loop: rectangle → group → thickness → name, repeated once per panel. Nothing is batched or deferred — each panel is fully identified before the modeler moves to the next one.

**Why group before push/pull, not after.** Grouping the flat rectangle first, then extruding inside the group, keeps every downstream edit (thickness change, hardware placement, groove cut) scoped to that one group. If you instead draw and extrude loose geometry and group it afterward, you risk accidentally including stray edges/faces from neighboring panels in the group — which breaks the "true solid" requirement.

**Face-front and back-only edits.** Push/Pull happens *inside* the group (double-click to enter edit context) so that the operation stays local to that panel's own geometry and doesn't merge with adjacent, ungrouped geometry in the parent context.

## Panel naming examples and what the name is later used for (labels, BOM)

Observed panel names from the tutorials, by role:

| Name (as typed) | Panel role |
|---|---|
| `Left` | Left side panel |
| `цоколь` | Toe-kick |
| `дно` | Bottom panel |
| `фасад` | Facade/door front |

The name typed at this modeling stage is not cosmetic — it is the value ABF later stamps onto every downstream artifact:

- **Labels (Розмітка).** ABF's labeling stage writes the panel name directly onto the auto-placed label, alongside a sequential part ID, a texture/grain-direction arrow, and (optionally) a company name. The label is itself stored as a nested child Group inside the panel's own group, so it travels with the panel if moved but breaks association if pulled out to the top level.
- **BOM / cut-list report (Звіт).** The name reappears as the part identifier in the exported Excel report, alongside dimensions, thickness, material, and edge-banding data per panel.
- **Rename tool reuse.** ABF's own "Перейменувати" (Rename) tool can batch-rename, add prefixes, apply presets, and strip auto-generated sequence numbers that the labeling stage previously appended — but it operates on whatever name was set at modeling time, so a clear name up front reduces rework later.

Practical implication: name panels for their *function in the cabinet* (`Left`, `Bottom`, `Facade`), not for their material or dimensions — those are separate attributes (material assignment, thickness) that ABF tracks independently and uses to auto-split panels into distinct groups during breakdown (see the parent contract doc's discussion of material/thickness-driven grouping).

## Diagnosing failures: ABF not detecting a shape means Component or non-solid group

If ABF fails to recognize, label, or otherwise process a shape on the model, the tutorials converge on exactly two root causes:

1. **It's actually a Component, not a Group.** ABF works only with Groups: "abf працює тільки з групами, з компонентами він не працює" ("ABF works only with groups; it does not work with components at all"). This happens most often with imported furniture-library items, copied fixtures, or dynamic components that were never explicitly converted. Fix: run ABF's own "Convert Component to Group" tool, which preserves parent/child hierarchy (a top-level module can stay a group with panel sub-groups inside it — conversion doesn't flatten everything to one level).
2. **It's a Group, but not a true solid / it's asymmetric.** A malformed or self-intersecting group fails SketchUp's own solid check. The labeling stage doubles as an implicit geometry-validity check: if the label silently fails to attach to a panel, that's a signal the panel's face is deformed or not identical front-to-back ("вона повинна бути однакова що з однієї сторони що з іншої" — the face must be the same on one side as the other). Absence of an expected groove (during auto-groove generation) is the same kind of signal for overlap geometry specifically.

There is a third failure mode worth flagging even though it isn't a "detection" failure per se: a SketchUp forum user reported ABF refuses to export groups containing cutout/notch geometry (e.g. a slot cut for a sliding back panel), exporting only flat/bounding-box-like surfaces instead. The practical rule this implies: **don't hand-model complex cuts into the panel body.** Model panels as plain rectangular solids and let ABF's own groove tool (see [Hardware Boring (Присадка) and Groove Joinery](../03-machining/02-hardware-boring-and-joinery.md)) generate the cut. This is consistent with panels needing to stay "flat" solids for ABF to process them correctly.

Quick diagnostic checklist:

| Symptom | Likely cause | Fix |
|---|---|---|
| Shape invisible to ABF entirely | It's a Component | Convert Component to Group |
| Label placement silently fails | Group is not a true solid, or front/back faces don't match | Check solid-inspector status; re-check face geometry for asymmetry |
| Auto-groove doesn't appear where two panels overlap | Overlap geometry itself is malformed | Re-check the overlapping panels' solid geometry |
| ABF only exports a flat rectangle, ignoring a hand-cut notch | Hand-modeled cutout geometry, not an ABF-recognized machining primitive | Model as a plain rectangular solid; use ABF's own groove tool instead |

## Implication for ZilInventor's own part/assembly data model

ZilInventor does not need an equivalent *rescue* mechanism (no "Convert Component to Group" tool) because its data model doesn't have the underlying failure mode ABF is working around.

**How ZilInventor's model differs structurally.**

- A `PartDocument` (`packages/shared/src/types.ts`) is a single named feature tree that resolves to solid geometry via the kernel — there is no separate "Component" entity that panel geometry might accidentally be trapped in. A part either has valid solid geometry from its feature tree or it doesn't; there's no parallel non-solid representation to convert out of.
- An `AssemblyDocument` holds `components: ComponentInstance[]`, where each instance references a part/sub-assembly by path and carries its own name and optional color override. This is structurally closer to ABF's *post-conversion* state (a grouped module with named panel sub-groups inside it) than to ABF's *pre-conversion* Component — ZilInventor's assembly graph is uniform from the start, so there's no equivalent of a native-SketchUp-Component trap that later needs flattening.
- Material assignment is a lookup against a `MaterialRegistry` (`packages/shared/src/material.ts`): each `MaterialEntry` carries an explicit `id`, `name`, and `defaultThickness` as typed fields. This is stronger than ABF's contract, which infers material identity from a decor/texture code embedded in a free-text material *name* (e.g. `"u702"`) and reads thickness from a separately-observed "шар" (layer) field. ZilInventor doesn't need naming discipline to carry thickness/material identity — it's structural, not string-encoded.

**Where ZilInventor does NOT yet enforce an equivalent contract.**

- ABF's "true solid" check is validated implicitly, at labeling time, by SketchUp's own solid inspector. ZilInventor's kernel similarly produces solid geometry from a feature tree, but nothing audits at authoring time whether a `PartDocument` is degenerate/non-manifold before it's consumed downstream (export, nesting, machining). This is the closest gap: ABF's "label fails to place → geometry is broken" diagnostic loop doesn't have a direct ZilInventor equivalent today (unverified whether one exists elsewhere in the export pipeline — not confirmed by this research pass).
- ABF's hard rule against hand-modeled cutout/notch geometry in the panel body (use the groove tool instead) has no enforced equivalent in ZilInventor. Nothing currently stops a panel's feature tree from including an arbitrary cut feature that a CNC groove/dado operation should have generated instead. This matters for the CNC/DXF export path (see [Machining Primitives](../03-machining/01-machining-primitives.md) and [CNC/DXF Export Format and Options](../04-production-output/02-cnc-dxf-export.md)) — an arbitrarily-shaped hand cut may not map cleanly onto a machining primitive the way an explicit groove feature does.

**Requirement this implies** (carried forward to the gap analysis in [Processing Parity Requirements](../05-parity/03-processing-parity-requirements.md)): ZilInventor's part authoring should distinguish "structural panel geometry" (the flat/rectangular solid body) from "machining features" (grooves, bores, notches) at the data-model level, the same way ABF enforces it procedurally through its groove tool plus a flat-solid-only export path — rather than allowing arbitrary cut features to be indistinguishable from panel-body shape.
