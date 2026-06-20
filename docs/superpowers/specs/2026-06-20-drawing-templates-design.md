# Milestone 3.3 — Drawing templates (design)

Date: 2026-06-20 · Branch: `feat/wall-tall-cabinets` · 3rd Milestone 3 slice.

## Goal
Export a drawing `DrawingSheet` as a reusable **template** (keep title block + underlay,
strip views/dimensions/annotations/dimension-groups), persist templates in OPFS, and create
a **new sheet from a template**. Add "Save as template" + "New from template" UI.

## Data model (pure, shared — NO manifest bump)
A template is a *separate artifact* (OPFS file), not document data, so no document migration.

`packages/shared/src/drawing/template.ts`:
```ts
export const DRAWING_TEMPLATE_FORMAT_VERSION = 1;
export type DrawingTemplate = {
  readonly formatVersion: number;
  readonly name: string;
  readonly size: SheetSize;
  readonly orientation: 'landscape' | 'portrait';
  readonly titleBlock: TitleBlockOverrides;
  readonly underlay?: DxfUnderlay;   // optional — conditional spread (exactOptionalPropertyTypes)
};
exportDrawingTemplate(sheet, name?): DrawingTemplate   // strips content
importDrawingTemplate(json: string): DrawingTemplate   // parse + validate; throws on bad shape
applyTemplateToNewSheet(t, {id, name}): DrawingSheet    // empty views/dims/annos/groups
```

## OPFS storage (app)
`packages/app/src/drawing/templateStorage.ts` over the kernel `Opfs` wrapper:
- dir `templates/`, file `templates/<slug>.zitpl` (JSON bytes).
- `saveTemplate(opfs, t) → path`, `listTemplates(opfs) → string[]`, `loadTemplate(opfs, path) → DrawingTemplate`.

## Command (app, undoable)
`AddSheetFromTemplateCommand({ template })` — mirrors `AddSheetCommand`; apply appends
`applyTemplateToNewSheet`, sets active; revert removes + restores prev active.

## UI (DrawingTab "Template" panel)
- "Save as template": `window.prompt` name → `saveTemplate(await Opfs.forNavigator(), exportDrawingTemplate(activeSheet, name))`.
- "New from template": list templates → minimal in-component picker modal → load + dispatch command.
- i18n keys `ribbon.drawing.saveAsTemplate` / `newFromTemplate` (+ tips) en/uk.

## TDD slices
1. `exportDrawingTemplate` strips content, keeps chrome (RED→GREEN, shared).
2. `applyTemplateToNewSheet` empty content + copies chrome (shared).
3. `importDrawingTemplate` round-trip preserves title block; invalid throws (shared).
4. `templateStorage` save/list/load round-trip vs FakeRoot (app).
5. `AddSheetFromTemplateCommand` apply/revert (app).
6. UI buttons + picker + i18n + §6 e2e `tests/e2e/drawing/templates.spec.ts` (new sheet title block matches template).

## Deferred
Template versioning on schema change; per-template thumbnails; overwrite-confirm on save; section/detail in templates (none carried — chrome only).
