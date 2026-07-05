---
title: Placing Components
---
# Placing Components
> Insert parts, sub-assemblies, or STEP imports into an assembly, then position, ground, or delete them.

**Where:** Assembly tab ▸ Component group ▸ Place · **Shortcut:** P (only active while an assembly document is open) · **Applies to:** assembly.

## What it does

The Component group is how you build up an assembly from pieces that already exist in project
storage (parts and sub-assemblies) or from an external STEP file. **Place** inserts a saved
`.zipt`/`.ziasm` file as a new component at the assembly origin. **Insert From STEP…** imports a
STEP file directly, creating one new part per solid body it contains. Once a component exists you
can reposition or recolor it with **Edit**, remove it with **Delete**, or lock it in place for the
constraint solver by grounding it. Nesting sub-assemblies inside other assemblies is fully
supported — an assembly component behaves like any other component for selection, editing, and
grounding.

## Before you start

- An assembly document must be open — every action in this group is disabled otherwise, and the
  **P** shortcut for Place does nothing.
- To place a saved part or sub-assembly, it must already exist in project storage **and** have a
  thumbnail — files without one are silently omitted from the Place Component grid (see Tips &
  gotchas).
- To use Edit, Delete, or Ground/Unground, select the target component first — Edit and Delete
  stay disabled with nothing selected, and Ground/Unground has no effect on an empty selection.

## Steps

### Place a saved part or sub-assembly

1. Click **Place** (or press **P**). The "Place Component" dialog opens, showing a 4-column grid
   of thumbnail tiles — one per `.zipt`/`.ziasm` file in project storage.
2. Click a tile to select it.
3. Click **Place**. The component is inserted at the assembly origin.

*Result: the new component appears in the 3D viewport and as a row in the Browser tree.*

### Insert a STEP file

1. Click **Insert From STEP…**.
2. In the file picker, choose a `.step`/`.stp` file, or a `.zip` containing one.
3. Confirm. A single-body STEP file becomes exactly one new component; a multi-body STEP file
   becomes one new component per sub-solid, each registered in project storage and placed at the
   assembly origin.

*Result: the new component(s) appear in the viewport and Browser tree. On failure, the status bar
reads "Insert From STEP failed: {error}" and nothing is added.*

### Edit a component's position, rotation, or color

1. Select the component in the viewport or Browser tree.
2. Click **Edit**. The "Edit Component" dialog opens.
3. Adjust the fields you need (see Options below), then confirm.

*Result: the component updates in place; the change is undoable.*

### Delete a component

1. Select the component.
2. Click **Delete**.

*Result: the component is removed from the assembly; undo restores the exact prior instance
data.*

### Ground or unground a component

1. Select a top-level component.
2. Press **G**.

*Result: a grounded component shows a chain-link (⛓) prefix in the Browser tree and is treated as
a fixed anchor by the constraint solver, removed from the DOF count. Press **G** again to
unground.*

## Options

Fields in the "Edit Component" dialog:

| Field | Meaning |
|---|---|
| Position (mm) — X / Y / Z | Number inputs for the component's origin offset within the assembly. |
| Rotation (deg) — RX / RY / RZ | Number inputs for the component's rotation about each axis. |
| visible | Checkbox — hides or shows the component in the viewport without deleting it. |
| Sub-assembly (N components) | Read-only note shown only when the selection is a sub-assembly; states how many components it contains. |
| Flexible | Checkbox shown only for sub-assembly selections. Checked, the sub-assembly's own internal constraints resolve independently instead of being frozen at its placed pose. |
| Color | Color picker drawing from the assembly's shared color palette. |

## Tips & gotchas

- A saved part or sub-assembly with no thumbnail is silently omitted from the Place Component
  grid — no error is shown. If a file you expect to see is missing, check whether it has a saved
  thumbnail.
- Double-clicking a top-level component row in the Browser tree also opens the Edit Component
  dialog — you don't have to select it first and click **Edit**.
- Right-clicking a sub-assembly component row in the Browser tree offers to open the underlying
  assembly standalone — for legacy cabinets that need it, this includes a one-click pose repair
  before opening.
- Right-clicking a leaf-part component row lets you override its color, or type the literal word
  "convert" to turn an imported STEP part into a parametric panel — see
  [Convert to Panel](../import-migration/convert-to-panel.md).
- There is no ribbon button for grounding — it's keyboard-only (**G**), and only works while an
  assembly is open.

## See also

- [Constraints](./constraints.md)
- [Patterns and Mirror](./patterns-and-mirror.md)
- [Bill of Materials](./bill-of-materials.md)
- [STEP Files](../import-migration/step-files.md)
- [Convert to Panel](../import-migration/convert-to-panel.md)
- [Keyboard Shortcuts](../reference/keyboard-shortcuts.md)
- [Glossary](../reference/glossary.md)

<!-- SCREENSHOT: the Place Component dialog showing the 4-column thumbnail grid with several parts and sub-assemblies — TODO follow-up -->
<!-- SCREENSHOT: the Edit Component dialog with Position, Rotation, visible checkbox, and Color picker fields visible — TODO follow-up -->
