# i18n Sweep Rules (read fully before editing)

You are sweeping **user-facing UI strings** into react-i18next `t()` calls in an
isolated git worktree. You may use `mcp__thinking__sequentialthinking` to plan.

**Worktree (your cwd):** `/Users/lion/Documents/Projects/mine/zilventor-i18n`
Branch `i18n-ukrainian` is checked out. i18next is ALREADY initialized
(`packages/app/src/i18n/index.ts`, default export `i18n`); `useTranslation()` from
`'react-i18next'` works; `en.json`/`uk.json` currently hold only `common.ok` /
`common.cancel`.

## HARD RULES — do NOT
- `git add` / `git commit` / `git push` / `pnpm install`.
- Edit `en.json`, `uk.json`, `index.ts`, `main.tsx`, or ANY file outside YOUR
  ASSIGNED SCOPE. Other agents edit other dirs concurrently — stay in your files.
- Run the full vitest suite (other agents are mid-edit). Typecheck only (below).

## Step 1 — find candidates
Grep ONLY your assigned files:
```
grep -rnE '>[A-Z][A-Za-z]|aria-label="|label="|title="|placeholder="|<option[^>]*>[A-Za-z]|showToast\(|setStatus\(|<th[^>]*>[A-Za-z]' <your files>
```

## Step 2 — replace each user-facing string with t('key')
- **Components (.tsx):** add `import { useTranslation } from 'react-i18next';` and
  `const { t } = useTranslation();` at the top of the component body (once per
  component). Examples:
  - `<h3>Extrude</h3>` → `<h3>{t('dialog.extrude.title')}</h3>`
  - `label="Distance"` → `label={t('dialog.extrude.distance')}`
  - `aria-label="Ribbon"` → `aria-label={t('aria.ribbon')}`
- **Non-component modules (.ts, e.g. commands):**
  `import i18n from '<correct relative path>/i18n';` then `i18n.t('toast.foo')`.
  Compute the relative path from the file to `src/i18n`.
- **Dynamic values — interpolate:**
  `showToast('Value must be greater than ' + min)` →
  `showToast(t('toast.valueMin', { min }))`, en value `"Value must be greater than {{min}}"`.

## TRANSLATE (give each a key)
On-screen JSX text; `label`/`title`/`placeholder`/`aria-label` props; `<option>`
text; app-UI `<th>` headers; dialog titles; ribbon/tab/menu labels;
`showToast(...)` / `setStatus(...)` user messages.

## DO NOT TRANSLATE — leave EXACTLY as-is
- Number formatting (`toFixed`, dimension display).
- CSV / DXF / PDF / PNG export builders.
- Anything that renders text INTO a printed **drawing-sheet SVG**: e.g.
  `SheetSvg`, `AnnotationElement`, `HoleTableElement`, `DimensionElement`,
  `TitleBlock` output, `ViewElement`, `renderDrawingSvg/Pdf/Png/Dxf`, `dxfWriter`.
  (Dialogs/panels/tables shown in the **app UI** ARE in scope — e.g. `BomTable`,
  `CutListTable`, `HardwareTable` render in app tabs → in scope.)
- `console.*`; `throw new Error('...')` NOT shown to the user; test files; comments;
  internal ids / enum values that are never displayed.
- If unsure whether a string renders to a drawing sheet vs an app panel → leave it
  English (out of scope) and note it in your report.

## Key naming
Group by area: `common.*` (ok/cancel/new/join/cut/delete/close/apply/add/remove/
yes/no/save/open/edit/import/export), `ribbon.*`, `tab.*`, `menu.*`,
`dialog.<feature>.*`, `panel.*`, `toast.*`, `status.*`, `aria.*`. Reuse `common.*`
for shared words instead of minting duplicates. Cross-cluster duplicate `common.*`
keys are fine (reconciliation dedupes).

## Fragment output (your deliverable)
`mkdir -p packages/app/src/i18n/fragments` (idempotent), then create ONLY your
`packages/app/src/i18n/fragments/<CLUSTER_ID>.json` — a FLAT JSON object mapping
each dotted key to `{"en": "...", "uk": "..."}`:
```json
{
  "dialog.extrude.title": { "en": "Extrude", "uk": "Витягування" },
  "common.new": { "en": "New", "uk": "Нова" }
}
```
Provide your best Ukrainian using the glossary; flag uncertain terms in your report.

## Glossary (use; extend sensibly)
Extrude=Витягування · Revolve=Обертання · Sweep=Зсув по траєкторії · Hole=Отвір ·
Fillet=Спряження · Chamfer=Фаска · Shell=Оболонка · Pattern=Масив · Mirror=Дзеркало ·
Sketch=Ескіз · Constraint=Залежність · Dimension=Розмір · Distance=Відстань ·
Assembly=Збірка · Part=Деталь · Component=Компонент · Material=Матеріал · Panel=Панель ·
Cabinet=Шафа · Edge band=Кромка · Cut list=Розкрій · Hardware=Фурнітура ·
Nest/Nesting=Розкладка · Drawing=Креслення · View=Вид · Sheet=Аркуш · присадка=присадка ·
New=Нова · Join=Об'єднати · Cut=Відняти · OK=OK · Cancel=Скасувати · Open=Відкрити ·
Save=Зберегти · Delete=Видалити · Add=Додати · Edit=Редагувати · Apply=Застосувати ·
Close=Закрити · Properties=Властивості · Parameters=Параметри · Color=Колір ·
Width=Ширина · Height=Висота · Depth=Глибина · Length=Довжина · Thickness=Товщина ·
Angle=Кут · Count=Кількість · Spacing=Крок · Diameter=Діаметр · Direction=Напрямок ·
Type=Тип · Name=Назва · Quantity=Кількість.

## Self-check (typecheck only — your files)
```
cd /Users/lion/Documents/Projects/mine/zilventor-i18n/packages/app && npx tsc --noEmit 2>&1 | grep "error TS"
```
Confirm none of the NEW errors are in YOUR edited files. These files ALREADY error
on master (baseline — ignore): `AssemblyTab.tsx`, `AnnotationElement.tsx`,
`DeleteViewCommand.ts`, `parseDxfUnderlay.ts`, and several `__tests__/*.spec.*`
(offset, OffsetTool, CommittedSketchRenderer, textureCache, importStepIntoNewParts,
computePartsListRows, dxfParserSmoke, parseDxfUnderlay, renderDrawingPdf, TitleBlock,
UpdatePrimitiveCommand, AddCustomTextureCommand). Other dirs may show transient
errors from concurrent agents — ignore those too; only YOUR files matter.

## Report (under 350 words)
Status (DONE / DONE_WITH_CONCERNS / BLOCKED); files you edited; count of strings
keyed; your fragment filename + key count; any file judged OUT of scope + why;
uncertain Ukrainian terms flagged; Self-critique = numbered weaknesses + numbered
assumptions + Confidence 0–100 + one-paragraph calibration (cap 300 words).
