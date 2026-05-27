# All-sheets / zip DXF export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new export buttons that package every sheet of a multi-sheet drawing into a single `.zip` of one-DXF-per-sheet — one for the sheet-scaled (WYSIWYG) renderer, one for the 1:1 (true-mm) renderer.

**Architecture:** Reuse the existing single-sheet renderers (`renderDrawingDxf`, `renderDrawingDxf1to1`) verbatim in a loop. A pure `buildDxfZip` helper wraps `fflate.zipSync` (synchronous, in-memory — no streamx main-thread backpressure deadlock). Two new commands mirror the existing single-sheet command pair. The UI adds two buttons rendered only when `drawing.sheets.length > 1`. Read-only export → no manifest bump, stays R12 (`AC1009`).

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (e2e), fflate (new direct dep of `packages/app`, version `0.8.2` already in the pnpm store via jspdf).

**Spec:** `docs/superpowers/specs/2026-05-27-all-sheets-dxf-export-design.md`

**Reference facts (verified against real code at HEAD `8da9a5c`):**
- `triggerDownload(blob, { suggestedName, mimeType, extension, description })` — `packages/app/src/nesting/triggerDownload.ts`.
- `renderDrawingDxf(drawing, sheet, source): string` — `packages/app/src/drawing/renderDrawingDxf.ts`.
- `renderDrawingDxf1to1(drawing, sheet): string` — `packages/app/src/drawing/renderDrawingDxf1to1.ts`.
- Existing single-sheet commands: `ExportDrawingDxfCommand` / `ExportDrawing1to1DxfCommand` in `packages/app/src/commands/`.
- DrawingTab: `packages/app/src/shell/tabs/DrawingTab.tsx`. Export panel ends ~line 336. Has `const source = useAppStore((s) => s.activePart ?? s.activeAssembly ?? s.activeDrawingSourceDocument)` and `const hasProjectedView = activeSheet?.views.some((v) => v.projection != null) ?? false`.
- DrawingView union: every kind has `readonly projection?: ...` (`packages/shared/src/drawing/types.ts`) so `v.projection != null` is valid across the union.
- **Implementer note (per project convention): plan code snippets are REFERENCE. Verify exact imports/identifiers against the real files before re-emitting; match surrounding style.**

---

### Task 1: `fflate` dependency + `buildDxfZip` helper

**Files:**
- Modify: `packages/app/package.json` (add `fflate` to `dependencies`)
- Create: `packages/app/src/drawing/dxfZip.ts`
- Test: `packages/app/src/drawing/__tests__/dxfZip.spec.ts`

- [ ] **Step 1: Add the dependency (two places) and install**

- Add `"fflate": "^0.8.2"` to the `dependencies` block of `packages/app/package.json` (runtime use by the new commands).
- Add `"fflate": "^0.8.2"` to the `devDependencies` block of the **root** `package.json` (the e2e spec in Task 5 imports `fflate` in Node scope; pnpm does NOT hoist it to root `node_modules`, and Node has no built-in pk-zip reader).

Keep alphabetical order if the blocks are sorted. Then, **from the worktree root**, run:

Run: `pnpm install`
Expected: completes; both `node -e "require.resolve('fflate',{paths:['packages/app']})"` and `node -e "require.resolve('fflate')"` (root) no longer throw.

- [ ] **Step 2: Write the failing test**

```ts
// packages/app/src/drawing/__tests__/dxfZip.spec.ts
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDxfZip } from '../dxfZip';

describe('buildDxfZip', () => {
  it('ZIP-1: round-trips entries — each DXF string recovered byte-exact under its name', () => {
    const entries = { '01-Sheet 1.dxf': 'DXF-A\nLINE', '02-Sheet 2.dxf': 'DXF-B' };
    const zip = buildDxfZip(entries);
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.length).toBeGreaterThan(0);
    const back = unzipSync(zip);
    expect(Object.keys(back).sort()).toEqual(['01-Sheet 1.dxf', '02-Sheet 2.dxf']);
    expect(strFromU8(back['01-Sheet 1.dxf']!)).toBe('DXF-A\nLINE');
    expect(strFromU8(back['02-Sheet 2.dxf']!)).toBe('DXF-B');
  });

  it('ZIP-2: empty input yields a valid (empty) zip', () => {
    const zip = buildDxfZip({});
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(Object.keys(unzipSync(zip))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfZip.spec.ts`
Expected: FAIL — `buildDxfZip` is not exported / module `../dxfZip` not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/app/src/drawing/dxfZip.ts
import { zipSync, strToU8 } from 'fflate';

/** Packs a set of named DXF strings into a single .zip (synchronous, in-memory). */
export function buildDxfZip(entries: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [name, dxf] of Object.entries(entries)) {
    data[name] = strToU8(dxf);
  }
  return zipSync(data);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/dxfZip.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/package.json pnpm-lock.yaml packages/app/src/drawing/dxfZip.ts packages/app/src/drawing/__tests__/dxfZip.spec.ts
git commit -m "feat(dxf-allsheets): fflate dep + buildDxfZip helper (zipSync, round-trip tested)"
```

---

### Task 2: `ExportAllSheetsDxfCommand` (WYSIWYG, all sheets)

**Files:**
- Create: `packages/app/src/commands/ExportAllSheetsDxfCommand.ts`
- Test: `packages/app/src/commands/__tests__/ExportAllSheetsDxfCommand.spec.ts`

Mirror `ExportDrawingDxfCommand` + the existing spec's mocking pattern (`vi.mock('../../nesting/triggerDownload')` and `vi.mock('../../drawing/renderDrawingDxf')`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/ExportAllSheetsDxfCommand.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportAllSheetsDxfCommand } from '../ExportAllSheetsDxfCommand';
import type { DrawingDocument, DrawingSheet, PartDocument } from '@zilventor/shared';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingDxf', () => ({
  renderDrawingDxf: vi.fn((_d, sheet) => `DXF for ${sheet.name}`),
}));

import { triggerDownload } from '../../nesting/triggerDownload';
import { renderDrawingDxf } from '../../drawing/renderDrawingDxf';

const sheet = (id: string, name: string): DrawingSheet => ({
  id, name, size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
  views: [], dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
});
const source = { id: 'p1', name: 'W', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [] } as unknown as PartDocument;
const drawing = (sheets: DrawingSheet[]): DrawingDocument => ({
  id: 'd1', name: 'MyDrawing', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
  sheets, activeSheetId: sheets[0]?.id ?? 's',
});

describe('ExportAllSheetsDxfCommand', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ALL-DXF-1: renders every sheet and downloads one zip', async () => {
    const dwg = drawing([sheet('s1', 'Sheet 1'), sheet('s2', 'Sheet 2')]);
    await new ExportAllSheetsDxfCommand({ drawing: dwg, source }).apply();
    expect(renderDrawingDxf).toHaveBeenCalledTimes(2);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob, opts] = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]! as [Blob, { suggestedName: string; mimeType: string; extension: string }];
    expect(opts.suggestedName).toBe('MyDrawing-all-sheets.zip');
    expect(opts.mimeType).toBe('application/zip');
    expect(opts.extension).toBe('zip');
    expect(blob.type).toBe('application/zip');
  });

  it('ALL-DXF-2: zip entries are index-prefixed per sheet, byte-exact', async () => {
    const { unzipSync, strFromU8 } = await import('fflate');
    const dwg = drawing([sheet('s1', 'Front'), sheet('s2', 'Top')]);
    await new ExportAllSheetsDxfCommand({ drawing: dwg, source }).apply();
    const blob = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Blob;
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const back = unzipSync(u8);
    expect(Object.keys(back).sort()).toEqual(['01-Front.dxf', '02-Top.dxf']);
    expect(strFromU8(back['01-Front.dxf']!)).toBe('DXF for Front');
  });

  it('ALL-DXF-3: throws when the drawing has no sheets', async () => {
    await expect(new ExportAllSheetsDxfCommand({ drawing: drawing([]), source }).apply())
      .rejects.toThrow(/no sheets/i);
  });

  it('ALL-DXF-4: revert is a no-op', async () => {
    await expect(new ExportAllSheetsDxfCommand({ drawing: drawing([sheet('s1', 'A')]), source }).revert())
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/ExportAllSheetsDxfCommand.spec.ts`
Expected: FAIL — command module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/commands/ExportAllSheetsDxfCommand.ts
import type { DrawingDocument, PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingDxf } from '../drawing/renderDrawingDxf';
import { buildDxfZip } from '../drawing/dxfZip';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportAllSheetsDxfCommand {
  readonly name = 'ExportAllSheetsDxf';

  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      source: PartDocument | AssemblyDocument;
    },
  ) {}

  async apply(): Promise<void> {
    const { drawing, source } = this.opts;
    if (drawing.sheets.length === 0) throw new Error('Drawing has no sheets to export');
    const entries: Record<string, string> = {};
    drawing.sheets.forEach((sheet, i) => {
      const idx = String(i + 1).padStart(2, '0');
      entries[`${idx}-${sheet.name}.dxf`] = renderDrawingDxf(drawing, sheet, source);
    });
    const blob = new Blob([buildDxfZip(entries)], { type: 'application/zip' });
    await triggerDownload(blob, {
      suggestedName: `${drawing.name}-all-sheets.zip`,
      mimeType: 'application/zip',
      extension: 'zip',
      description: 'DXF drawing set (one DXF per sheet)',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/ExportAllSheetsDxfCommand.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/ExportAllSheetsDxfCommand.ts packages/app/src/commands/__tests__/ExportAllSheetsDxfCommand.spec.ts
git commit -m "feat(dxf-allsheets): ExportAllSheetsDxfCommand (WYSIWYG, zip-per-sheet)"
```

---

### Task 3: `ExportAllSheets1to1DxfCommand` (true-mm, projection-only sheets)

**Files:**
- Create: `packages/app/src/commands/ExportAllSheets1to1DxfCommand.ts`
- Test: `packages/app/src/commands/__tests__/ExportAllSheets1to1DxfCommand.spec.ts`

Key difference from Task 2: **only sheets with ≥1 projected view are included**; index prefix tracks the sheet's position in `drawing.sheets` (so gaps are expected when a sheet is skipped); no `source`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/ExportAllSheets1to1DxfCommand.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportAllSheets1to1DxfCommand } from '../ExportAllSheets1to1DxfCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingDxf1to1', () => ({
  renderDrawingDxf1to1: vi.fn((_d, sheet) => `1TO1 ${sheet.name}`),
}));

import { triggerDownload } from '../../nesting/triggerDownload';
import { renderDrawingDxf1to1 } from '../../drawing/renderDrawingDxf1to1';

const baseView = { id: 'bv', kind: 'base' as const, positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front' as const, showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
  inputFingerprint: 'fp' };
const sheet = (id: string, name: string, withProj: boolean): DrawingSheet => ({
  id, name, size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
  views: withProj ? [baseView] : [], dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
});
const drawing = (sheets: DrawingSheet[]): DrawingDocument => ({
  id: 'd1', name: 'MyDrawing', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
  sheets, activeSheetId: sheets[0]?.id ?? 's',
});

describe('ExportAllSheets1to1DxfCommand', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ALL-1TO1-1: includes only sheets with a projected view; entries keep source index (gaps allowed) and -1to1 suffix', async () => {
    const { unzipSync } = await import('fflate');
    // sheet index 0 (no proj, skipped), index 1 (proj), index 2 (no proj, skipped), index 3 (proj)
    const dwg = drawing([
      sheet('s0', 'Cover', false),
      sheet('s1', 'Front', true),
      sheet('s2', 'Notes', false),
      sheet('s3', 'Top', true),
    ]);
    await new ExportAllSheets1to1DxfCommand({ drawing: dwg }).apply();
    expect(renderDrawingDxf1to1).toHaveBeenCalledTimes(2);
    const blob = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Blob;
    const back = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(back).sort()).toEqual(['02-Front-1to1.dxf', '04-Top-1to1.dxf']);
    const opts = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as { suggestedName: string; mimeType: string };
    expect(opts.suggestedName).toBe('MyDrawing-all-sheets-1to1.zip');
    expect(opts.mimeType).toBe('application/zip');
  });

  it('ALL-1TO1-2: throws when no sheet has a projected view', async () => {
    const dwg = drawing([sheet('s0', 'Cover', false), sheet('s1', 'Notes', false)]);
    await expect(new ExportAllSheets1to1DxfCommand({ drawing: dwg }).apply())
      .rejects.toThrow(/projected view/i);
  });

  it('ALL-1TO1-3: revert is a no-op', async () => {
    await expect(new ExportAllSheets1to1DxfCommand({ drawing: drawing([sheet('s1', 'A', true)]) }).revert())
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/ExportAllSheets1to1DxfCommand.spec.ts`
Expected: FAIL — command module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/app/src/commands/ExportAllSheets1to1DxfCommand.ts
import type { DrawingDocument } from '@zilventor/shared';
import { renderDrawingDxf1to1 } from '../drawing/renderDrawingDxf1to1';
import { buildDxfZip } from '../drawing/dxfZip';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportAllSheets1to1DxfCommand {
  readonly name = 'ExportAllSheets1to1Dxf';

  constructor(private readonly opts: { drawing: DrawingDocument }) {}

  async apply(): Promise<void> {
    const { drawing } = this.opts;
    const entries: Record<string, string> = {};
    drawing.sheets.forEach((sheet, i) => {
      if (!sheet.views.some((v) => v.projection != null)) return;
      const idx = String(i + 1).padStart(2, '0');
      entries[`${idx}-${sheet.name}-1to1.dxf`] = renderDrawingDxf1to1(drawing, sheet);
    });
    if (Object.keys(entries).length === 0) {
      throw new Error('No sheet has a projected view to export');
    }
    const blob = new Blob([buildDxfZip(entries)], { type: 'application/zip' });
    await triggerDownload(blob, {
      suggestedName: `${drawing.name}-all-sheets-1to1.zip`,
      mimeType: 'application/zip',
      extension: 'zip',
      description: 'DXF drawing set at 1:1 (machining size)',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/ExportAllSheets1to1DxfCommand.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/ExportAllSheets1to1DxfCommand.ts packages/app/src/commands/__tests__/ExportAllSheets1to1DxfCommand.spec.ts
git commit -m "feat(dxf-allsheets): ExportAllSheets1to1DxfCommand (true-mm, projection-only sheets)"
```

---

### Task 4: DrawingTab — two new buttons (shown only when >1 sheet)

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx` (export-command imports ~lines 9-10; `source` is at line 16 and `hasProjectedView` at line 26 — add the new derived flags right after `hasProjectedView`; Export panel JSX after the "Export DXF (1:1)" button, before `</RibbonPanel>` at line 336)
- Test: `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx` (append a new `describe`)

- [ ] **Step 1: Write the failing tests**

Append to `DrawingTab.spec.tsx`. Note the existing seed (`seedDrawing()`) has ONE sheet; build a two-sheet variant locally.

```tsx
describe('DrawingTab — All-sheets DXF export buttons', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
    // An earlier test in this file sets activeDrawingSourceDocument and never clears it;
    // setActiveDocument(null) does NOT touch that slot. Clear it so `source` is truly null
    // for ALLBTN-3 (the Zustand store is a shared singleton across describes in one file).
    useAppStore.setState({ activeDrawingSourceDocument: null } as never);
  });

  const projView = {
    id: 'bv1', kind: 'base' as const, positionMm: { x: 20, y: 20 },
    scale: { numerator: 1, denominator: 1 }, orientation: 'front' as const, showHidden: false,
    projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
    inputFingerprint: 'fp1',
  };
  const twoSheetDrawing = (withProjection: boolean): DrawingDocument => {
    const base = seedDrawing();
    const s1 = { ...base.sheets[0]!, views: withProjection ? [projView] : [] };
    const s2 = { ...base.sheets[0]!, id: 'sh2', name: 'Sheet 2', views: withProjection ? [projView] : [] };
    return { ...base, sheets: [s1, s2] };
  };

  it('ALLBTN-1: all-sheets buttons are ABSENT for a single-sheet drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.queryByRole('button', { name: /^export all sheets \(dxf\)$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^export all sheets \(1:1\)$/i })).not.toBeInTheDocument();
  });

  it('ALLBTN-2: both all-sheets buttons are PRESENT for a multi-sheet drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(true) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(dxf\)$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^export all sheets \(1:1\)$/i })).toBeInTheDocument();
  });

  it('ALLBTN-3: all-sheets WYSIWYG is disabled without a source', () => {
    // activePart/activeAssembly/activeDrawingSourceDocument all null
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(true) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(dxf\)$/i })).toBeDisabled();
  });

  it('ALLBTN-4: all-sheets 1:1 is disabled when no sheet has a projected view', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(false) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(1:1\)$/i })).toBeDisabled();
  });

  it('ALLBTN-5: all-sheets 1:1 is enabled when a sheet has a projected view', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(true) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(1:1\)$/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter app exec vitest run src/shell/tabs/__tests__/DrawingTab.spec.tsx -t "All-sheets DXF"`
Expected: FAIL — buttons not found (ALLBTN-2/-5 fail; ALLBTN-1 may pass trivially since the buttons don't exist yet — that's fine).

- [ ] **Step 3: Implement the buttons**

In `DrawingTab.tsx`, add imports next to the existing export-command imports (after line 10):

```tsx
import { ExportAllSheetsDxfCommand } from '../../commands/ExportAllSheetsDxfCommand';
import { ExportAllSheets1to1DxfCommand } from '../../commands/ExportAllSheets1to1DxfCommand';
```

Add derived flags next to `hasProjectedView` (after line 26):

```tsx
const isMultiSheet = drawing.sheets.length > 1;
const anySheetHasProjectedView = drawing.sheets.some((s) => s.views.some((v) => v.projection != null));
```

Insert inside the Export `<RibbonPanel>`, immediately after the "Export DXF (1:1)" button (after line 335, before `</RibbonPanel>`):

```tsx
{isMultiSheet && (
  <>
    <button
      type="button"
      className="text-xs hover:text-white disabled:text-neutral-500"
      aria-label="Export All Sheets (DXF)"
      disabled={!source}
      title={source ? 'Export every sheet as a DXF (zip)' : 'Source document not loaded'}
      onClick={() => {
        if (!source) return;
        void bus.execute(new ExportAllSheetsDxfCommand({ drawing, source }));
      }}
    >
      Export All Sheets (DXF)
    </button>
    <button
      type="button"
      className="text-xs hover:text-white disabled:text-neutral-500"
      aria-label="Export All Sheets (1:1)"
      disabled={!anySheetHasProjectedView}
      title={anySheetHasProjectedView ? 'Export every sheet at 1:1 (zip)' : 'No projected views to export'}
      onClick={() => {
        void bus.execute(new ExportAllSheets1to1DxfCommand({ drawing }));
      }}
    >
      Export All Sheets (1:1)
    </button>
  </>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter app exec vitest run src/shell/tabs/__tests__/DrawingTab.spec.tsx`
Expected: PASS — the new `All-sheets DXF` describe (5 tests) AND the pre-existing "5 Export buttons" test (still uses the 1-sheet seed, so the new buttons don't render → count unchanged).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: clean.

```bash
git add packages/app/src/shell/tabs/DrawingTab.tsx packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx
git commit -m "feat(dxf-allsheets): DrawingTab All Sheets DXF + 1:1 buttons (shown only when >1 sheet)"
```

---

### Task 5: e2e — real-environment round-trip (T-6-25)

**Files:**
- Create: `tests/e2e/drawing/all-sheets-dxf.spec.ts` (T-6-25)

This is **the gate** (CLAUDE.md §6). Mirror the most recent DXF e2e for the harness/download-capture mechanism.

- [ ] **Step 1: Locate and study the existing DXF e2e**

Run: `ls tests/e2e/drawing/ && grep -rln "ExportDrawing1to1DxfCommand\|waitForEvent('download')\|__zilventorStore" tests/e2e/drawing/`
Expected: finds the T-6-24 (DXF 1:1) and T-6-22 (DXF) specs. Read whichever exercises the 1:1 export — copy its setup: how it boots the app, creates a part-sourced drawing with a projected base view, exposes `window.__zilventorStore`, captures the download (Playwright `page.waitForEvent('download')` + `download.path()` / `createReadStream`), and imports a command via `await import('/src/commands/<Cmd>.ts')` inside `page.evaluate` (drawing commands are NOT window-exposed).

- [ ] **Step 2: Write the e2e**

Author T-6-25 to:
1. Boot the app, create/open a part-sourced drawing with **two sheets**, each holding a base view with a real projection (add a second sheet + project a base view on each — reuse the helpers the existing DXF e2e uses to add a sheet and a base view).
2. Drive the real UI: click **"Export All Sheets (DXF)"**, capture the `.zip` download; then click **"Export All Sheets (1:1)"**, capture that `.zip`.
3. In Node test scope, read each downloaded zip into a `Uint8Array` and `unzipSync` it (`import { unzipSync, strFromU8 } from 'fflate'`).
4. Assert the WYSIWYG zip has **2 entries** named `01-*.dxf` / `02-*.dxf`, each parses as a DXF (`strFromU8(...)` contains `AC1009` and `ENTITIES`).
5. Assert the 1:1 zip has **2 entries** (`*-1to1.dxf`) and at least one real geometry coordinate at true mm (mirror T-6-24's extent assertion on one entry).
6. **Read the browser console** during the run (existing specs attach a `page.on('console')` collector) and assert no errors — every drawing feature's prod gap surfaced only here.

Reference assertion shape (adapt to the real helpers in the existing spec):

```ts
const zipBytes = new Uint8Array(fs.readFileSync(await wysiwygDownload.path()!));
const entries = unzipSync(zipBytes);
const names = Object.keys(entries).sort();
expect(names).toHaveLength(2);
expect(names[0]).toMatch(/^01-.*\.dxf$/);
expect(strFromU8(entries[names[0]!]!)).toContain('AC1009');
```

- [ ] **Step 3: Run the e2e**

Run: `pnpm test:e2e -- tests/e2e/drawing/all-sheets-dxf.spec.ts --project=chromium`
Expected: PASS. If a prod gap surfaces (e.g. a button disabled when it shouldn't be, a render throw), STOP and apply `superpowers:systematic-debugging` — do NOT stub around it.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/drawing/all-sheets-dxf.spec.ts
git commit -m "test(dxf-allsheets): T-6-25 real-env 2-sheet zip round-trip (parse-back, both buttons)"
```

---

### Task 6: perf probe (T63m)

**Files:**
- Create or append: `tests/perf/<existing-drawing-perf-spec>` (T63m) — mirror T63l (the DXF 1:1 perf probe).

- [ ] **Step 1: Locate the existing DXF perf probe**

Run: `grep -rln "T63l\|T63k\|renderDrawingDxf1to1\|renderDrawingDxf" tests/perf/`
Expected: finds the perf spec carrying T63k/T63l. Read it for the fixture builder (a drawing with projected geometry) and the p95 timing harness.

- [ ] **Step 2: Write the perf probe**

Add T63m: build a multi-sheet drawing (e.g. 8 sheets, each with a projected base view), measure p95 of `new ExportAllSheetsDxfCommand({...}).apply()` with `triggerDownload` mocked/stubbed to a no-op (or measure `buildDxfZip(entriesRenderedForAllSheets)` directly to isolate render+zip). Budget: 50ms p95 (same class as T63l; expect large headroom — string render + sync zip).

```ts
// shape (adapt to the existing harness)
it('T63m: all-sheets DXF render+zip p95 < 50ms', () => {
  const drawing = buildNSheetDrawing(8);
  const p95 = measureP95(() => {
    const entries: Record<string, string> = {};
    drawing.sheets.forEach((s, i) => { entries[`${String(i+1).padStart(2,'0')}-${s.name}.dxf`] = renderDrawingDxf(drawing, s, source); });
    buildDxfZip(entries);
  });
  expect(p95).toBeLessThan(50);
});
```

- [ ] **Step 3: Run the perf probe**

Run: `pnpm test:perf -- tests/perf/<spec>`
Expected: PASS, p95 well under 50ms.

- [ ] **Step 4: Commit**

```bash
git add tests/perf/<spec>
git commit -m "test(dxf-allsheets): T63m all-sheets render+zip perf probe (p95 < 50ms)"
```

---

## Final gate (run before declaring done / FINAL review)

- [ ] `pnpm -r typecheck` — clean across all 5 packages.
- [ ] `pnpm -r test:unit` — 2 dxfZip + 4 ALL-DXF + 3 ALL-1TO1 + 5 ALLBTN = 14 new app unit tests → **1814 app**; shared/kernel/sketcher unchanged → **2929 total** (731 + 37 + 347 + 1814). Confirm count, no regressions.
- [ ] e2e T-6-25 + perf T63m green (commands above).
- [ ] `pnpm lint` — 0 errors. **Run lint INSIDE the worktree or after worktree cleanup** — root `pnpm lint` does NOT ignore `.worktrees/` and reports hundreds of false errors from the worktree copy.
- [ ] FINAL-pass Sonnet reviewer (mandatory) — verify each new test has teeth (temporarily break the production path → confirm RED), check for stubs/masking, confirm the e2e drives the REAL flow.

## Self-Review (author)

- **Spec coverage:** zip packaging (Task 1) ✓; both commands (Tasks 2-3) ✓; WYSIWYG=all-sheets, 1:1=projection-only-with-index-gaps (Tasks 2-3) ✓; two buttons gated on >1 sheet + correct disabled gates (Task 4) ✓; e2e parse-back (Task 5) ✓; perf (Task 6) ✓; superstring-label trap handled via anchored regexes (Task 4 tests) ✓. No spec requirement left unmapped.
- **Placeholder scan:** e2e (Task 5) and perf (Task 6) intentionally defer to the existing-spec harness rather than inventing a divergent boot/download mechanism — Step 1 of each forces the implementer to read and mirror the real pattern. All unit-test code is complete and literal.
- **Type consistency:** command constructors `{ drawing, source }` / `{ drawing }` match the buttons' `bus.execute(new ...)` args; `buildDxfZip(Record<string,string>): Uint8Array` consumed identically in both commands and tested via `unzipSync`; `v.projection != null` matches the existing `hasProjectedView` expression.
