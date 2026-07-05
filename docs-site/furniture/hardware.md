---
title: Hardware
---
# Hardware
> Adds a hardware SKU — built-in or custom-imported — to the active assembly and its bill of
> materials.

**Where:** Furniture ▸ Hardware ▸ **Add Hardware** · **Shortcut:** — · **Applies to:**
assembly

## What it does

Add Hardware picks a single SKU from the hardware catalog, sets a quantity, and adds it to
the active assembly via `AddHardwareCommand`. The built-in catalog ships 17 SKUs across six
categories (hinges, shelf pins, drawer handles, drawer slides, leg levelers, soft-close
hinges); you can also import a custom JSON catalog to add your own entries alongside them.
Whatever you add here shows up in the assembly's hardware/BOM table.

## Before you start

- Have an assembly open. **Add Hardware** is disabled — tooltip *"Open or create an assembly
  first"* — until an assembly exists.

## Steps

1. Click **Add Hardware** in the Furniture ▸ Hardware ribbon panel.
2. The **Add Hardware** dialog opens with Category set to Hinges by default.
3. Pick a Category, then select a SKU from the radio list (shows name, L×W×H mm, and notes).
4. Set Qty.
5. (Optional) Click **Import SKU…** first to load a custom catalog — its entries appear
   alongside the built-in ones once loaded.
6. Click **OK**.

*Result: the picked SKU is added to the assembly at the chosen quantity and appears in the
hardware/BOM table.*

## Options

| Field | Meaning |
|---|---|
| Category | **Hinges** or **Shelf Pins** — the only two categories this dialog exposes, even though the catalog holds more. |
| SKU | Radio list filtered by Category; shows name, bounding box (mm), and any notes. |
| Qty | 1–100, via +/− stepper. Default 1. |
| Import SKU… | Loads a JSON file of custom hardware entries into the catalog. |

## Tips & gotchas

- **The Category dropdown only offers Hinges and Shelf Pins**, even though the built-in
  catalog has 17 SKUs across six categories. Drawer handles, leg levelers, and drawer slides
  aren't reachable from this dialog — they're added through their own dedicated tools:
  [Handles and Pulls](../drilling-prisadka/handles-and-pulls.md),
  [Leg Levelers](../drilling-prisadka/leg-levelers.md), and the **Slide system** field in
  [Add Drawers](./drawer-banks.md).
- A custom-catalog JSON file holds one entry or an array of entries, each needing `id`,
  `name`, `category` (one of the six categories above), `bboxMm: {l, w, h}`, and
  `attachPoints`; leg-leveler entries can add a screw-pattern block. Import is all-or-nothing
  — one bad or duplicate `id` fails the whole batch.

![Add Hardware dialog with the Hinges category, a hinge selected, and Import SKU option](/img/furniture/hardware.png)

## See also

- [Cabinets](./cabinets.md)
- [Cut List](./cut-list.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)
