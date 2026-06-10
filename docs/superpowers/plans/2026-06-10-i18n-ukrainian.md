# i18n + Ukrainian Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `react-i18next` to the ZilInventor app, sweep all on-screen UI strings into `t('key')` lookups, ship a complete Ukrainian translation, and add an auto-detecting EN/UK language switcher with persisted manual override.

**Architecture:** i18next is initialized once in `main.tsx` from static `en.json`/`uk.json` bundles, with `i18next-browser-languagedetector` resolving `localStorage → navigator → fallback 'en'`. Components read strings via `useTranslation()`. The full-sweep correctness gate is a parity test asserting `en.json` and `uk.json` have identical key sets. Generated output (drawing SVG annotations, CSV/DXF, number formatting) is explicitly out of scope.

**Tech Stack:** React 18, Vite 5, TypeScript 5.5, Vitest 2, `i18next` + `react-i18next` + `i18next-browser-languagedetector`, Zustand (unchanged), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-10-i18n-ukrainian-design.md`

**Conventions for every task below:**
- All vitest for the app package runs from `packages/app/`: `cd packages/app && npx vitest run --config vitest.config.ts <path>`.
- Typecheck: `cd packages/app && npx tsc --noEmit`.
- No manifest bump (i18n is runtime-only).
- Commit after each task with the message shown.

---

## Phase 0 — Foundation (fully specified, TDD)

### Task 1: Install i18n dependencies

**Files:**
- Modify: `packages/app/package.json`

- [ ] **Step 1: Install the three packages**

Run from repo root:
```bash
cd packages/app && pnpm add i18next react-i18next i18next-browser-languagedetector
```
Expected: `package.json` `dependencies` gains `i18next`, `react-i18next`, `i18next-browser-languagedetector`; `pnpm-lock.yaml` updates; install succeeds.

- [ ] **Step 2: Verify versions resolved**

Run: `cd packages/app && node -e "console.log(require('./package.json').dependencies['react-i18next'])"`
Expected: prints a version string (non-empty).

- [ ] **Step 3: Commit**

```bash
git add packages/app/package.json pnpm-lock.yaml
git commit -m "build(i18n): add i18next + react-i18next + language detector"
```

---

### Task 2: Translation resource files + parity test

Create the two locale bundles (initially with one shared smoke key) and the
load-bearing parity test that guards the entire sweep.

**Files:**
- Create: `packages/app/src/i18n/locales/en.json`
- Create: `packages/app/src/i18n/locales/uk.json`
- Create: `packages/app/src/i18n/parity.test.ts`

- [ ] **Step 1: Write the failing parity test**

`packages/app/src/i18n/parity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import uk from './locales/uk.json';

/** Recursively collect dotted key paths from a nested translation object. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === 'object'
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

describe('locale parity', () => {
  it('en.json and uk.json have identical key sets', () => {
    const enKeys = keyPaths(en).sort();
    const ukKeys = keyPaths(uk).sort();
    const missingInUk = enKeys.filter((k) => !ukKeys.includes(k));
    const missingInEn = ukKeys.filter((k) => !enKeys.includes(k));
    expect({ missingInUk, missingInEn }).toEqual({ missingInUk: [], missingInEn: [] });
  });

  it('no Ukrainian value is empty', () => {
    const empties = keyPaths(uk).filter((path) => {
      const val = path.split('.').reduce<any>((o, k) => o?.[k], uk);
      return typeof val === 'string' && val.trim() === '';
    });
    expect(empties).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/parity.test.ts`
Expected: FAIL — cannot resolve `./locales/en.json` (files don't exist yet).

- [ ] **Step 3: Create the two locale files with one smoke key**

`packages/app/src/i18n/locales/en.json`:
```json
{
  "common": {
    "ok": "OK",
    "cancel": "Cancel"
  }
}
```

`packages/app/src/i18n/locales/uk.json`:
```json
{
  "common": {
    "ok": "OK",
    "cancel": "Скасувати"
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/parity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Ensure JSON module imports typecheck**

If `tsc` errors on JSON import, confirm `resolveJsonModule: true` in
`packages/app/tsconfig.json` (Vite default). If absent, add it under
`compilerOptions`.

Run: `cd packages/app && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json packages/app/src/i18n/parity.test.ts packages/app/tsconfig.json
git commit -m "feat(i18n): locale bundles + parity test"
```

---

### Task 3: i18next initialization + config test

**Files:**
- Create: `packages/app/src/i18n/index.ts`
- Create: `packages/app/src/i18n/index.test.ts`

- [ ] **Step 1: Write the failing config test**

`packages/app/src/i18n/index.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import i18n from './index';

describe('i18n config', () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) await i18n.init();
  });

  it('supports en and uk only', () => {
    expect(i18n.options.supportedLngs).toContain('en');
    expect(i18n.options.supportedLngs).toContain('uk');
  });

  it('falls back to en', () => {
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });

  it('resolves a known key', () => {
    expect(i18n.t('common.ok')).toBe('OK');
  });

  it('returns Ukrainian after changeLanguage', async () => {
    await i18n.changeLanguage('uk');
    expect(i18n.t('common.cancel')).toBe('Скасувати');
    await i18n.changeLanguage('en');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement the i18n init**

`packages/app/src/i18n/index.ts`:
```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import uk from './locales/uk.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      uk: { translation: uk },
    },
    supportedLngs: ['en', 'uk'],
    fallbackLng: 'en',
    load: 'languageOnly', // uk-UA -> uk; unsupported -> fallback 'en'
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export default i18n;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Import i18n in app entry before App mounts**

In `packages/app/src/main.tsx`, add the side-effect import **above** the `App`
import:
```ts
import './i18n';
```
(Place it as the first project-local import so i18next is initialized before any
component calls `useTranslation()`.)

- [ ] **Step 6: Verify the app still builds**

Run: `cd packages/app && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/i18n/index.ts packages/app/src/i18n/index.test.ts packages/app/src/main.tsx
git commit -m "feat(i18n): initialize i18next with locale detection in app entry"
```

---

### Task 4: Language switcher in the title bar

**Files:**
- Create: `packages/app/src/i18n/LanguageSwitcher.tsx`
- Create: `packages/app/src/i18n/LanguageSwitcher.test.tsx`
- Modify: `packages/app/src/App.tsx` (title-bar area, near the `ZilInventor` wordmark ~line 4706)

- [ ] **Step 1: Write the failing component test**

`packages/app/src/i18n/LanguageSwitcher.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from './index';
import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(cleanup);

describe('LanguageSwitcher', () => {
  it('renders EN and UK choices', () => {
    render(<LanguageSwitcher />);
    expect(screen.getByRole('button', { name: /EN/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /UK|УК/ })).toBeTruthy();
  });

  it('changes the active language on click', async () => {
    await i18n.changeLanguage('en');
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /UK|УК/ }));
    expect(i18n.language).toBe('uk');
    await i18n.changeLanguage('en');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/LanguageSwitcher.test.tsx`
Expected: FAIL — cannot resolve `./LanguageSwitcher`.

- [ ] **Step 3: Implement the switcher**

`packages/app/src/i18n/LanguageSwitcher.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

const LANGS: { code: 'en' | 'uk'; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'uk', label: 'УК' },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const active = i18n.language?.startsWith('uk') ? 'uk' : 'en';
  return (
    <div role="group" aria-label="Language" style={{ display: 'flex', gap: 4 }}>
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          aria-pressed={active === code}
          onClick={() => i18n.changeLanguage(code)}
          style={{
            padding: '2px 6px',
            fontSize: 12,
            fontWeight: active === code ? 700 : 400,
            opacity: active === code ? 1 : 0.6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/LanguageSwitcher.test.tsx`
Expected: PASS (2 tests). If `@testing-library/react` is not installed, check
existing component tests for the project's render helper and match their import;
do not add a new test library if one is already in use.

- [ ] **Step 5: Mount the switcher in the title bar**

In `packages/app/src/App.tsx`, locate the `ZilInventor` wordmark (~line 4706) and
render `<LanguageSwitcher />` adjacent to it (right side of the top bar). Add the
import at the top: `import { LanguageSwitcher } from './i18n/LanguageSwitcher';`.

- [ ] **Step 6: Typecheck**

Run: `cd packages/app && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/i18n/LanguageSwitcher.tsx packages/app/src/i18n/LanguageSwitcher.test.tsx packages/app/src/App.tsx
git commit -m "feat(i18n): EN/UK language switcher in title bar"
```

---

## Phase 1 — The Sweep (parallelizable per cluster)

The sweep replaces every **user-facing on-screen** literal with a `t('key')` call
and records the English value in `en.json` + a draft Ukrainian value in `uk.json`.
Run the clusters in parallel subagents; each cluster is independent (it only adds
keys and edits its own files). The **parity test** + **tsc** are the gate after each.

### Sweep transformation rules (apply in every cluster task)

**DO translate** (give each a key):
- JSX text nodes: `<h3>Extrude</h3>` → `<h3>{t('dialog.extrude.title')}</h3>`
- User-facing props: `label`, `title`, `placeholder`, `aria-label`, `<option>` text,
  app-UI `<th>` headers, dialog titles.
- User messages: `showToast('Value must be greater than zero.')` →
  `showToast(t('toast.valueMin', { min: 0 }))`; `setStatus('...')` likewise.

**DO NOT touch:**
- Anything under `packages/app/src/drawing/` that renders to **SVG drawing sheets**
  (annotation text, hole-table headers) — out of scope this slice.
- CSV/DXF writers (`dxfWriter.ts`, BOM/cut-list CSV builders) — canonical English.
- Number formatting (`toFixed`, dimension display) — leave as-is (dot decimals).
- `throw new Error('...')` developer messages **unless** the same string is shown to
  the user via toast/status (then key it).
- `console.*`, test files, comments.

**Key naming:**
- Group by area: `common.*`, `ribbon.*`, `tab.*`, `menu.*`, `dialog.<feature>.*`,
  `panel.*`, `toast.*`, `status.*`, `aria.*`.
- Reuse `common.*` for OK/Cancel/New/Join/Cut/Delete/Close/Apply/Add/Remove/Yes/No
  rather than minting per-dialog duplicates.
- Interpolate dynamic parts: `"Imported {{count}} bodies"` →
  `t('toast.importedBodies', { count })` (use i18next plural suffixes for counts).

**Adding `useTranslation`:** In each component that gains a `t(...)` call, add
`import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();`
at the top of the component body. For non-component modules (e.g. a command helper
that builds a toast string), import the singleton: `import i18n from '../i18n';`
and call `i18n.t(...)`.

**Per-cluster done criteria (the task is not done until all pass):**
1. `cd packages/app && npx tsc --noEmit` — clean.
2. `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/parity.test.ts` — green (every new `en` key has a `uk` counterpart, no empty `uk` value).
3. The cluster's own existing tests still pass.
4. Residual-literal grep for the cluster's files returns only allowed cases
   (see Task 12 sweep-completeness grep for the exact command).

---

### Task 5: Cluster — Shell dialogs A–K

**Files:** every `*.tsx` in `packages/app/src/shell/` whose component name sorts
A–K (e.g. `AddViewDialog`, `ChamferDialog`, `ExtrudeDialog`, `FilletDialog`,
`HoleDialog`, `HardwareDialog`, …). Modify each; add keys to `en.json`/`uk.json`.

- [ ] **Step 1:** For each file, apply the sweep transformation rules above. Example
  (`ExtrudeDialog.tsx`):
  - `<h3>Extrude</h3>` → `<h3>{t('dialog.extrude.title')}</h3>`
  - `<label>Distance</label>` → `<label>{t('dialog.extrude.distance')}</label>`
  - `"New"`/`"Join"`/`"Cut"` → `t('common.new')`/`t('common.join')`/`t('common.cut')`
  - Add `en.json`: `dialog.extrude.title: "Extrude"`, `dialog.extrude.distance: "Distance"`.
  - Add `uk.json`: `dialog.extrude.title: "Витягування"`, `dialog.extrude.distance: "Відстань"`.
- [ ] **Step 2:** Run tsc + parity test + shell tests (done criteria 1–4).
- [ ] **Step 3:** Commit: `git commit -m "feat(i18n): sweep shell dialogs A-K"`

---

### Task 6: Cluster — Shell dialogs L–Z + tabs/statusbar/browser pane

**Files:** remaining `packages/app/src/shell/` `*.tsx` (L–Z dialogs,
`BrowserPane.tsx`, `StatusBar.tsx`, tab components, `MaterialRegistryEditor.tsx`,
ribbon tab labels).

- [ ] **Step 1:** Apply sweep rules. Ribbon/tab labels → `ribbon.*`/`tab.*`; browser
  pane node labels and status bar text → `panel.*`/`status.*`. Reuse `common.*`.
- [ ] **Step 2:** Run done criteria 1–4.
- [ ] **Step 3:** Commit: `git commit -m "feat(i18n): sweep shell L-Z + tabs/status/browser"`

---

### Task 7: Cluster — commands (user-facing toasts/labels only)

**Files:** `packages/app/src/commands/**/*.ts(x)` — but **only** strings that reach
the user (toast/status text, command display labels). Skip internal IDs, error
messages never shown, log output.

- [ ] **Step 1:** For each user-facing string, replace with `i18n.t('toast.*' | 'menu.*')`
  (import the `i18n` singleton in non-component modules). Add keys.
- [ ] **Step 2:** Run done criteria 1–4 (plus `src/commands` existing tests).
- [ ] **Step 3:** Commit: `git commit -m "feat(i18n): sweep command toasts/labels"`

---

### Task 8: Cluster — assembly + model + nesting + import

**Files:** `packages/app/src/assembly/`, `src/model/`, `src/nesting/`, `src/import/`
`*.tsx` user-facing strings (panels, dialogs, buttons, BOM **tab** UI headers that
render in-app — NOT the CSV export).

- [ ] **Step 1:** Apply sweep rules. BOM tab column headers shown on screen → `panel.bom.*`.
  (CSV builder stays English.)
- [ ] **Step 2:** Run done criteria 1–4.
- [ ] **Step 3:** Commit: `git commit -m "feat(i18n): sweep assembly/model/nesting/import"`

---

### Task 9: Cluster — sketcher + viewport + drawing **UI controls**

**Files:** `packages/app/src/sketcher/`, `src/viewport/`, and in `src/drawing/`
**only** the React UI controls/panels (e.g. `DrawingTreePane.tsx`, toolbar buttons,
`AddViewDialog` orientation options if not already covered) — **NOT** the SVG sheet
renderers (`renderDrawingSvg.ts`, `AnnotationElement.tsx`, `HoleTableElement.tsx`,
`DimensionElement.tsx`) which are out of scope.

- [ ] **Step 1:** Apply sweep rules to the UI-control files only. If unsure whether a
  string renders to a drawing **sheet** vs. an app **panel**, leave drawing-sheet
  output alone (out of scope).
- [ ] **Step 2:** Run done criteria 1–4.
- [ ] **Step 3:** Commit: `git commit -m "feat(i18n): sweep sketcher/viewport/drawing-ui"`

---

### Task 10: Cluster — App.tsx

**Files:** `packages/app/src/App.tsx` (5,043 lines — the largest surface: top bar,
menus, inline dialogs, many `showToast(...)` calls).

- [ ] **Step 1:** Apply sweep rules across App.tsx. Add `const { t } = useTranslation();`
  in the `App` component (and any other components defined in the file). Examples:
  - `showToast('Over-defined: sketch has conflicting constraints.')` →
    `showToast(t('toast.overDefined'))`
  - `showToast('Value must be greater than zero.')` → `showToast(t('toast.valueMin', { min: 0 }))`
  - `aria-label="Ribbon"` → `aria-label={t('aria.ribbon')}`
- [ ] **Step 2:** Run done criteria 1–4 (App.tsx-related tests + full app test run).
- [ ] **Step 3:** Commit: `git commit -m "feat(i18n): sweep App.tsx"`

---

## Phase 2 — Reconciliation & Ukrainian quality

### Task 11: Reconcile JSON + finalize Ukrainian translations

**Files:** `packages/app/src/i18n/locales/en.json`, `uk.json`

- [ ] **Step 1: Hoist duplicates.** Search both JSON files for repeated English
  values that were keyed per-dialog (e.g. multiple `"Distance"`); move genuinely
  shared ones into `common.*` and update call sites. Keep domain-specific strings
  local even if text coincides (translation may diverge).
- [ ] **Step 2: Fill all Ukrainian values** with domain-correct CAD/furniture terms.
  Reference glossary (extend as needed):

  | English | Ukrainian |
  |---|---|
  | Extrude | Витягування |
  | Revolve | Обертання |
  | Sweep | Зсув по траєкторії |
  | Hole | Отвір |
  | Fillet | Спряження |
  | Chamfer | Фаска |
  | Shell | Оболонка |
  | Pattern | Масив |
  | Mirror | Дзеркало |
  | Sketch | Ескіз |
  | Constraint | Залежність |
  | Dimension | Розмір |
  | Assembly | Збірка |
  | Part | Деталь |
  | Component | Компонент |
  | Material | Матеріал |
  | Panel | Панель |
  | Cabinet | Шафа |
  | Edge band | Кромка |
  | Cut list | Розкрій |
  | Hardware | Фурнітура |
  | присадка | присадка |
  | Distance | Відстань |
  | New / Join / Cut | Нова / Об'єднати / Відняти |
  | OK / Cancel | OK / Скасувати |
  | Open / Save | Відкрити / Зберегти |

  Flag any term you are unsure of in the commit body for the native-speaker lead.
- [ ] **Step 3: Add Ukrainian plurals** for count-bearing keys using i18next suffixes
  (`key_one`, `key_few`, `key_many`, `key_other`). Example in `uk.json`:
  ```json
  "toast": {
    "importedBodies_one": "Імпортовано {{count}} тіло",
    "importedBodies_few": "Імпортовано {{count}} тіла",
    "importedBodies_many": "Імпортовано {{count}} тіл"
  }
  ```
  and the English `toast.importedBodies_one` / `_other`.
- [ ] **Step 4:** Run parity test — green.

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/i18n/locales/
git commit -m "feat(i18n): finalize Ukrainian translations + plurals + hoist common keys"
```

---

### Task 12: Sweep-completeness grep + pluralization tests

**Files:**
- Create: `packages/app/src/i18n/plural.test.ts`

- [ ] **Step 1: Grep for residual hardcoded user-facing literals.**

Run (from repo root):
```bash
grep -rnE '(<(h[1-6]|button|label|option|th|span|div)[^>]*>[A-Z][a-z]+ ?[A-Za-z ]*<)|aria-label="[A-Z]|label="[A-Z]|title="[A-Z]|placeholder="[A-Z]|showToast\((['"`])[A-Z]|setStatus\((['"`])[A-Z]' \
  packages/app/src --include=*.tsx --include=*.ts \
  | grep -v '/i18n/' | grep -v '.test.' | grep -v '/drawing/render' | grep -v 'AnnotationElement' | grep -v 'HoleTableElement' | grep -v 'DimensionElement'
```
Expected: each hit is either (a) genuinely out-of-scope (drawing sheet / CSV / DXF),
or (b) a missed string → key it and add to JSON, then re-run. Iterate until only
allowed cases remain. **Log the final allowed-exceptions list in the commit body**
(no silent truncation).

- [ ] **Step 2: Write a pluralization/interpolation test**

`packages/app/src/i18n/plural.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import i18n from './index';

describe('uk pluralization', () => {
  beforeAll(async () => { await i18n.changeLanguage('uk'); });

  it('selects the correct Ukrainian plural form', () => {
    expect(i18n.t('toast.importedBodies', { count: 1 })).toContain('тіло');
    expect(i18n.t('toast.importedBodies', { count: 3 })).toContain('тіла');
    expect(i18n.t('toast.importedBodies', { count: 5 })).toContain('тіл');
  });

  it('interpolates values', () => {
    expect(i18n.t('toast.valueMin', { min: 0 })).toContain('0');
  });
});
```
(Adjust the asserted key names to whatever the sweep actually produced; if a chosen
plural key doesn't exist, pick a real count-bearing key from `uk.json`.)

- [ ] **Step 3:** Run it.

Run: `cd packages/app && npx vitest run --config vitest.config.ts src/i18n/plural.test.ts`
Expected: PASS. Reset language to `en` is handled by test isolation; if other tests
flake on language state, add `afterAll(() => i18n.changeLanguage('en'))`.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/i18n/plural.test.ts
git commit -m "test(i18n): pluralization + sweep-completeness verification"
```

---

## Phase 3 — Full verification

### Task 13: Full suite + typecheck

- [ ] **Step 1:** Run the whole app test suite.

Run: `cd packages/app && npx vitest run --config vitest.config.ts`
Expected: all green (baseline ~2570 app tests + the new i18n tests).

- [ ] **Step 2:** Typecheck the package.

Run: `cd packages/app && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3:** Build.

Run: `cd packages/app && npx vite build`
Expected: build succeeds.

- [ ] **Step 4:** If anything fails, fix before proceeding. No commit unless fixes
  were needed (then `git commit -m "fix(i18n): <what>"`).

---

### Task 14: §6 browser verification (load-bearing)

Verify in a real browser, not just tests. Delegate the driving to a subagent and
read the screenshots back.

- [ ] **Step 1: Start the dev server from this worktree on a free port.**

Run (background): `cd packages/app && npx vite --port 5199`
(Pick a port not already in use; do NOT collide with another running server.)

- [ ] **Step 2: Drive the browser (Playwright / webapp-testing skill).**
  1. Open `http://localhost:5199`.
  2. With browser locale Ukrainian, confirm the UI auto-loads Ukrainian (ribbon
     tabs, menus). Screenshot.
  3. Click the title-bar switcher → EN; confirm UI flips to English. Screenshot.
  4. Open 2–3 dialogs (Extrude, Hole, a panel/cabinet dialog) in Ukrainian.
     Screenshot each.
  5. Confirm a dimension still shows dot decimals (e.g. `12.50`), and open/generate
     a drawing sheet — confirm its annotations remain **English** (out of scope).
     Screenshot.
  6. Reload the page; confirm the chosen language persisted (localStorage).
- [ ] **Step 3: Read every screenshot back.** Confirm: Ukrainian renders correctly
  (no `common.ok`-style raw keys = missing translations), switcher works, persistence
  works, numbers stay dot-decimal, drawing output stays English.
- [ ] **Step 4:** If raw keys appear on screen, that's a missing JSON key →
  systematic-debugging: find the key, add it to both locales, re-verify.

---

### Task 15: Final review + finish branch

- [ ] **Step 1:** Use `superpowers:requesting-code-review` for a whole-branch review
  (correctness, missed strings, key-naming consistency, no out-of-scope output
  touched, no manifest bump).
- [ ] **Step 2:** Address findings (receiving-code-review skill).
- [ ] **Step 3:** Use `superpowers:finishing-a-development-branch` to merge `--no-ff`
  to `master` and push.
- [ ] **Step 4:** Update auto-memory + `.remember/remember.md` handoff.

---

## Self-Review (against the spec)

**Spec coverage:**
- Library (react-i18next + detector) → Tasks 1, 3. ✓
- Locale bundles + hierarchical keys → Task 2, used throughout sweep. ✓
- Parity test (correctness gate) → Task 2; enforced every cluster + Task 12. ✓
- Auto-detect + persisted override → Task 3 (detector order) + Task 4 (switcher) + Task 14 step 6 (persistence verified). ✓
- Full sweep of UI strings → Tasks 5–10 cover shell, commands, assembly/model/nesting/import, sketcher/viewport/drawing-UI, App.tsx. ✓
- UI-only (exclude drawing sheets/CSV/DXF/numbers) → stated in sweep rules, Tasks 8/9 carve-outs, Task 12 grep excludes, Task 14 step 5 verifies. ✓
- Switcher in title bar → Task 4. ✓
- Ukrainian quality + plurals → Task 11, tested Task 12. ✓
- Testing (unit/parity/plural/§6 browser) → Tasks 2,3,4,12,13,14. ✓
- No manifest bump → noted in header + Task 15. ✓

**Placeholder scan:** Foundation tasks (1–4) and Tasks 11–14 carry full code/commands.
Sweep tasks (5–10) intentionally define a precise transformation procedure with real
before/after examples rather than enumerating ~500 strings (infeasible and discovered
at execution); the parity test + grep + tsc make their completion objectively
verifiable. This is a deliberate structure, not a placeholder.

**Type consistency:** `keyPaths` helper (Task 2) reused conceptually only; i18n
singleton exported as default from `src/i18n/index.ts` and imported as `i18n` in
non-component modules (Tasks 7, 12) and via `useTranslation()` in components. Key
namespaces (`common/ribbon/tab/menu/dialog/panel/toast/status/aria`) are consistent
across Tasks 5–11. Switcher uses `i18n.changeLanguage` / `i18n.language` consistent
with the config in Task 3.
