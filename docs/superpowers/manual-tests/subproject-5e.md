# Sub-project 5e — Manual smoke checklist

Run after merge, on the user's local box. Mirrors the 5b/5c/5d patterns.

## Setup
- `pnpm dev` from repo root, open the printed URL.
- Open DevTools console.

## T1 — One cabinet → one sheet
1. New assembly. Furniture → Panel → Manage… → + Add material **Birch 18mm**,
   Default thickness: `18`, color: any. In the **Sheet L (mm)** column enter `2440`,
   **Sheet W (mm)** enter `1220`. Save. Close Panel dialog.
2. Furniture → Cabinets → Base Cabinet (defaults, pick Birch 18mm as Carcass material). OK.
3. Furniture → Nesting → Generate Nest. Kerf `3`. OK.
4. Click **Nesting tab** (in the BrowserPane tab strip).
5. **Expect:** 1 material section "Birch 18mm — 1 sheet(s), avg ~XX% util". At least 1 SVG sheet. Panel rectangles carry #item labels matching the Cut List tab.

## T2 — Three cabinets across two materials → two sections
1. Continue from T1 state.
2. Furniture → Panel → Manage… → + Add material **Plywood 12mm**, Default thickness: `12`,
   color: any, Sheet L: `2440`, Sheet W: `1220`. Save. Close Panel dialog.
3. Furniture → Cabinets → Base Cabinet, change **Back material** to Plywood 12mm. OK.
   Repeat once more (a third cabinet, also using Plywood 12mm for Back).
4. Furniture → Nesting → Generate Nest. Kerf `3`. OK. Open Nesting tab.
5. **Expect:** Two material sections (Birch 18mm and Plywood 12mm), each with ≥1 sheet.

## T3 — Material with no sheet stock → excluded section
1. Continue from T2 state.
2. Furniture → Panel → Manage… → + Add material **Veneer 4mm**, Default thickness: `4`,
   color: any. **Leave Sheet L (mm) and Sheet W (mm) empty.** Save. Close.
3. Furniture → Cabinets → Base Cabinet, set Back material to Veneer 4mm. OK.
4. Furniture → Nesting → Generate Nest. Kerf `3`. OK. Open Nesting tab.
5. **Expect:** Existing material sections (Birch, Plywood) still render correctly.
   Excluded section at bottom lists: `Veneer 4mm: no sheet stock defined`.

## T4 — Edit cabinet → stale banner → Regenerate
1. Continue from T3 state (nest already generated).
2. Furniture → Cabinets → Base Cabinet, change **Height** to `900`. OK.
3. Open Nesting tab.
4. **Expect:** `⚠️ Cut list changed since last nest.` banner with a **Regenerate** button.
5. Click **Regenerate**.
6. **Expect:** Banner disappears; sheet count and panel sizes reflect the taller cabinet.

## Sign-off

| Date | Initials | Pass / Notes |
|---|---|---|
| | | |
