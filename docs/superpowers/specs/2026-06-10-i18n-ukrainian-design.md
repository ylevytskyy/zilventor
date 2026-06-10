# Internationalization (i18n) + Ukrainian Translation — Design

**Date:** 2026-06-10
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** `packages/app` (React + Vite + TypeScript)

## Goal

Add internationalization to the ZilInventor app and ship a complete Ukrainian
translation of the **on-screen UI**, for the Ukrainian furniture-CAD team. App
auto-detects the browser locale and lets users switch EN/UK manually, with the
choice persisted.

## Decisions (locked during brainstorm)

1. **Library:** `react-i18next` (+ `i18next`, `i18next-browser-languagedetector`).
2. **Scope:** **Full sweep** of UI strings now (not a teaser slice).
3. **Default language:** **Auto-detect** browser locale (`uk*` → Ukrainian, else
   English) with a **manual override persisted** to `localStorage`.
4. **Output text:** **UI-only this slice.** Generated output (drawing-sheet SVG
   annotations, BOM / cut-list CSV headers, DXF text) stays canonical English.

## Architecture

### Init
- New `packages/app/src/i18n/index.ts` configures i18next:
  - `supportedLngs: ['en', 'uk']`, `fallbackLng: 'en'`, `load: 'languageOnly'`
    (so `uk-UA` → `uk`, any non-Ukrainian → `en` via fallback).
  - `i18next-browser-languagedetector` with `order: ['localStorage', 'navigator']`,
    `caches: ['localStorage']`, lookup key `i18nextLng`.
  - `interpolation.escapeValue: false` (React already escapes).
  - Resources imported statically (single bundle per language; the app loads
    everything at once — no lazy namespaces).
- Imported once in `main.tsx` **before** `<App/>` mounts.

### Translation resources
- `src/i18n/locales/en.json` and `src/i18n/locales/uk.json`.
- **Hierarchical keys grouped by area:**
  - `common.*` — ok, cancel, new, join, cut, delete, close, apply, …
  - `ribbon.*`, `tab.*`, `menu.*`
  - `dialog.<feature>.*` — e.g. `dialog.extrude.title`, `dialog.extrude.distance`
  - `panel.*` (browser pane, BOM tab, properties, material registry, …)
  - `toast.*`, `status.*`
  - `aria.*`
- **Interpolation** for dynamic strings, e.g.
  `toast.valueMin: "Value must be greater than {{min}}"`.
- **Pluralization** via i18next suffixes (`_one`/`_few`/`_many`/`_other`) wherever
  a count is shown — Ukrainian has 3 plural forms; English has 2.
- **Parity test (load-bearing):** a vitest asserts the *key sets* of `en.json` and
  `uk.json` are identical (no missing or orphaned keys). This is the primary
  correctness gate for a full sweep across 160+ files.

### What is translated
- All on-screen JSX text content.
- String props that render to the user: `label`, `title`, `placeholder`,
  `aria-label`, `<option>` text, table `<th>` rendered in the app UI (BOM tab,
  browser pane, etc.), dialog titles, ribbon / tab / menu labels.
- User-facing messages: `showToast(...)`, `setStatus(...)`.

### What is explicitly NOT translated (this slice)
- `drawing/` **SVG annotation** text rendered onto drawing sheets
  (ITEM / QTY / PART NAME / MATERIAL / DIMENSIONS / EDGE BANDS, hole-table headers).
- **CSV** export headers (BOM, cut list) and **DXF** text — machine/interop output.
- **Number formatting.** Dimensions keep dot-decimal `toFixed(...)` to match CAD
  convention and stay consistent with the (untranslated) exports. No
  `Intl.NumberFormat` / comma-decimal changes.
- Developer-only `throw new Error("...")` messages, unless surfaced directly to the
  user via a toast/status (those get keys).

### Language switcher
- Compact **EN / UK** selector in the top title bar, next to the `ZilInventor`
  wordmark (`App.tsx` ~line 4706).
- Calls `i18n.changeLanguage(lng)`; the detector persists to `localStorage`.
- **No new Zustand slice** — i18next is the single source of truth; `useTranslation()`
  drives component re-render on language change.

## Data flow

```
main.tsx
  └─ import './i18n'           // detector picks localStorage → navigator → fallback 'en'
       └─ i18next initialized (en + uk resources)
App / components
  └─ const { t } = useTranslation()
       └─ t('dialog.extrude.title')  → looks up active language, falls back to en
Title-bar switcher
  └─ i18n.changeLanguage('uk')  → detector caches to localStorage → all t() re-render
```

## Execution mechanics (informs the plan)

The full sweep is parallelizable. Each subagent owns a directory cluster
(shell dialogs, commands, assembly, model, sketcher, viewport, drawing UI-only
bits, App.tsx). Per file: extract user-facing literals → replace with `t('key')`
(adding `useTranslation()` where missing) → append keys to `en.json` and a draft
`uk.json`. A reconciliation pass merges the JSON, hoists shared strings into
`common.*`, removes duplicates, and runs the parity + typecheck + test suite.

**Ukrainian terminology:** domain-correct CAD/furniture terms are produced by the
implementer and committed for the native-speaker lead to review, e.g.
Extrude → Витягування, Revolve → Обертання, Hole → Отвір, Fillet → Спряження,
Chamfer → Фаска, Shell → Оболонка, Sweep → Зсув по траєкторії, Pattern → Масив,
Mirror → Дзеркало, Assembly → Збірка, Sketch → Ескіз, Constraint → Залежність,
присадка → присадка. Terms the implementer is unsure of are flagged in the PR/notes.

## Testing & verification

- **Unit:**
  - i18n config — detector order, `fallbackLng`, `uk-UA` → `uk`, unsupported → `en`.
  - **Parity test** — `en.json` ⇄ `uk.json` key-set equality.
  - A handful of components render Ukrainian text under a test i18n provider
    (`i18n.changeLanguage('uk')`).
- **Typecheck:** `tsc` clean (catches missed prop/JSX edits).
- **§6 browser gate (load-bearing):** launch the app, confirm auto-detect, flip the
  switcher to UK, screenshot the ribbon + 2–3 dialogs in Ukrainian, confirm
  dimensions still render with dot decimals and a generated drawing sheet stays
  English. Read the screenshots back.

## Out of scope (named for later slices)

- Localized drawing output (SVG annotations / title blocks).
- CSV / DXF header localization.
- Decimal-separator localization (comma decimals) for any locale.
- RTL support; additional languages beyond en/uk.
- In-app translation-management tooling.

## Risks

- **Missed strings** across 160+ files → mitigated by the parity test + a grep
  sweep for residual hardcoded literals in the §6 pass + tsc.
- **Wrong CAD terminology** → mitigated by lead review of `uk.json`.
- **Plural/interpolation correctness** in Ukrainian → covered by targeted unit
  tests on count-bearing strings.
- **Manifest:** none — i18n is app-runtime only, no document-schema change, **no
  manifest version bump**.
