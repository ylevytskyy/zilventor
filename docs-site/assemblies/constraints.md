---
title: Constraints
---
# Constraints
> Position components relative to each other with Mate, Flush, Angle, and Insert constraints, then edit, delete, or suppress them as the assembly evolves.

**Where:** Assembly tab ▸ Constraint group · **Shortcut:** see table below · **Applies to:** assembly.

## What it does

The four ribbon buttons in the Constraint group — **Mate**, **Flush**, **Angle**, and
**Insert** — all open the same **Place Constraint** dialog, just pre-set to a different
starting mode:

| Button | Shortcut | What you pick | Parameter |
|---|---|---|---|
| Mate | M | a face on component A, a face on component B | Offset (mm) |
| Flush | F | face + face | Offset (mm) |
| Angle | N | an axis on each component | Angle (°) |
| Insert | I | a circular edge on each component | Offset (mm) |

All four shortcuts only work while an assembly document is open.

**Mate** and **Flush** look similar but do opposite things: Mate makes the two picked faces
face each other with opposing normals — like stacking two plates face-to-face with a gap
equal to Offset. Flush makes them coplanar and facing the same direction — like
flush-mounting two panels side by side.

The dialog's **Type** dropdown also exposes two constraint kinds with no ribbon button of
their own — **Coincident** and **Tangent** — reachable only by opening one of the four
dialogs above and then switching Type.

A status-bar segment tracks how constrained the assembly is overall and updates live as you
add, remove, or suppress constraints, or ground/unground components (see
[Placing Components](./placing-components.md)).

## Before you start

- An assembly document must be open — the ribbon buttons are disabled otherwise, and none of
  the shortcuts in the table above do anything.
- At least two components placed. Constraints resolve relative positions between components,
  so you typically want at least one grounded component as a fixed anchor before constraining
  the rest.
- To use **Edit Constraint** or **Delete Constraint**, select an existing constraint first —
  both stay disabled with nothing selected.

## Steps

> **Caution:** pressing the **M** or **F** keys while an assembly is open currently opens
> unrelated part-feature dialogs (Mirror / Fillet) instead of the Mate/Flush constraint
> dialog, due to a keyboard-shortcut conflict elsewhere in the app. Always use the **Mate**
> and **Flush** ribbon buttons — don't rely on the M/F letter shortcuts while an assembly is
> open. **Angle (N)**, **Insert (I)**, and **Suppress (Ctrl+Shift+S)** are not affected and
> work as expected.

### Place a Mate, Flush, Angle, or Insert constraint

1. Click **Mate**, **Flush**, **Angle**, or **Insert** on the Assembly tab. The "Place
   Constraint" dialog opens with **Type** pre-set to match the button you clicked.
2. Click **Selection 1**'s "Pick…" button, then click the reference on the first component in
   the 3D viewport (a face for Mate/Flush, an axis for Angle, a circular edge for Insert).
3. Click **Selection 2**'s "Pick…" button, then click the matching reference on the second
   component.
4. Enter the value in the parameter field (labeled "Offset:", "Angle:", or "Radius r:"
   depending on Type).
5. Click **OK** (or **Apply** to create it and keep placing more).

*Result: the new constraint appears in the Browser tree, and the two components move to
satisfy it. The status-bar DOF segment updates to reflect the new degree-of-freedom count.*

### Place a Coincident or Tangent constraint

1. Open the Place Constraint dialog from any of the four ribbon buttons.
2. Change the **Type** dropdown to **Coincident** or **Tangent**. The pick buttons and
   parameter field relabel to match.
3. Pick **Selection 1** and **Selection 2**, fill in the parameter field if one appears, and
   click **OK**.

*Result: the constraint is created the same as any other type — Coincident and Tangent just
have no ribbon shortcut of their own.*

### Edit an existing constraint

1. Select the constraint — click its row in the Browser tree, or double-click the row to skip
   straight to step 3.
2. Click **Edit Constraint** on the Assembly tab.
3. The Place Constraint dialog reopens pre-filled with the constraint's current Type,
   selections, and value. Change what you need and click **OK**.

*Result: the constraint updates in place and the assembly re-solves; the change is
undoable.*

### Delete a constraint

1. Select the constraint in the Browser tree.
2. Click **Delete Constraint** on the Assembly tab.

*Result: the constraint is removed and the assembly re-solves as if it never existed; undo
restores it.*

### Suppress or unsuppress a constraint

1. Select the constraint in the Browser tree.
2. Click **Suppress** on the Assembly tab (or press **Ctrl+Shift+S**). The button's label
   toggles to **Unsuppress** once the constraint is suppressed — click it again, or press
   Ctrl+Shift+S again, to restore the constraint.

*Result: a suppressed constraint is skipped by the solver but not deleted — it renders
dimmed with strikethrough text in the Browser tree until unsuppressed.*

### Check the DOF / solver status

1. Once the assembly has at least one constraint, look at the status bar.
2. Read the colored segment: green "Assembly: fully constrained", yellow "Assembly: {n} DOF"
   (still under-constrained), red "Assembly: over-constrained", or red "Assembly: solver did
   not converge".

*Result: nothing to click — this segment just reflects the live solver state and updates
whenever you add, remove, or suppress a constraint, or ground/unground a component.*

## Options

Fields in the "Place Constraint" / "Edit Constraint" dialog:

| Field | Meaning |
|---|---|
| Type | Dropdown selecting the constraint kind: Mate, Flush, Angle, Insert, Coincident, or Tangent. Changing it changes what Selection 1/2 expect and which parameter field appears. |
| Selection 1 / Selection 2 | "Pick…" buttons that arm a viewport pick cursor for the constraint's two references — a face, an axis, or a circular edge, depending on Type. |
| Offset: / Angle: / Radius r: | The value field's label switches with Type: "Offset:" for Mate, Flush, and Insert; "Angle:" for Angle; "Radius r:" for Tangent. |
| Apply | Creates the constraint and keeps the dialog open, so you can pick the next pair without reopening it. |
| Cancel | Closes the dialog without creating anything. |
| OK | Creates the constraint and closes the dialog. |

## Tips & gotchas

- **Don't use the M/F keyboard shortcuts while an assembly is open** — see the caution above.
  Angle (N), Insert (I), and Suppress (Ctrl+Shift+S) are unaffected.
- A suppressed constraint shows dimmed with strikethrough text in the Browser tree, which is
  the quickest way to spot which constraints are currently inactive without opening each one.
- The **DOF / solver status** segment only appears once the assembly has at least one
  constraint — with zero constraints placed, there's nothing to show.
- Grounding a component (see [Placing Components](./placing-components.md)) removes it from
  the DOF count entirely, which is often the fastest way to clear a yellow "under-constrained"
  status without adding more constraints.

## See also

- [Placing Components](./placing-components.md)
- [Assemblies](./index.md)
- [Keyboard Shortcuts](../reference/keyboard-shortcuts.md)
- [Glossary](../reference/glossary.md)

<!-- SCREENSHOT: the Place Constraint dialog set to Mate, showing the Type dropdown, Selection 1/Selection 2 pick buttons, and the Offset field — TODO follow-up -->
<!-- SCREENSHOT: the status-bar DOF/solver segment showing the yellow "Assembly: {n} DOF" state — TODO follow-up -->
