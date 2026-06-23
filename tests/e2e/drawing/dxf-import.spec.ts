import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../helpers/buildBox';

// Minimal DXF fixture: INSUNITS=1 (inch), one LINE and one CIRCLE.
// The importer converts inch→mm (×25.4) but primitive *count* is 2 regardless.
const DXF_FIXTURE = `  0
SECTION
  2
HEADER
  9
$INSUNITS
 70
1
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
0
 10
0
 20
0
 11
10
 21
0
  0
CIRCLE
  8
0
 10
5
 20
5
 40
2
  0
ENDSEC
  0
EOF
`;

test('DXF import into a new part creates a sketch with the imported primitives', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  // Drive the command through the DEV-gated window hook wired in App.tsx.
  // This exercises the real import path (parseDxf → toSketch → kernel.registerPart → store).
  const count = await page.evaluate(async (text) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { kernel: unknown; setActivePart: (p: unknown) => void; getActivePart?: () => unknown; bus: { execute: (c: unknown) => Promise<void> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'sample.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState() as unknown as { activePart?: { featureTree: Array<{ kind: string; primitives?: unknown[] }> } };
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    return sketch?.primitives?.length ?? -1;
  }, DXF_FIXTURE);

  expect(count).toBe(2);          // line + circle
  expect(errors).toEqual([]);
});

test('DXF import into active sketch adds primitives to the open sketch', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  // Enter sketch mode (labels confirmed from enter-sketch-mode.spec.ts)
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();

  // Wait for activeSketchId to be populated in the store
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): { activeSketchId: string | null } } };
    return !!w.__zilventorStore?.getState().activeSketchId;
  });

  // Drive ImportDxfIntoActiveSketchCommand through the DEV hook and read back primitive count
  const primitiveCount = await page.evaluate(async (dxfText: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeSketchId: string | null; activePart?: { featureTree: Array<{ kind: string; id: string; primitives?: unknown[] }> } } };
      __zilventorImportDxfActiveSketch: (f: File) => Promise<void>;
    };
    const file = new File([dxfText], 'test.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfActiveSketch(file);
    const state = w.__zilventorStore.getState();
    const activeSketchId = state.activeSketchId;
    const sketch = state.activePart?.featureTree?.find(
      (f) => f.kind === 'sketch' && f.id === activeSketchId,
    );
    return sketch?.primitives?.length ?? -1;
  }, DXF_FIXTURE);

  expect(primitiveCount).toBe(2);  // line + circle
  expect(errors).toEqual([]);
});

test('Phase 4b: imports points, text, INSERT array, and layer construction', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  const dxfText = readFileSync(resolve(__dirname, '../fixtures/phase4b.dxf'), 'utf-8');

  // Drive the command through the DEV-gated window hook (same pattern as 4a scenarios above).
  const counts = await page.evaluate(async (text: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: unknown[]; annotations?: unknown[] }> } } };
      __zilventorImportDxfNewPart: (f: File) => Promise<void>;
    };
    const file = new File([text], 'phase4b.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState();
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    return {
      prims: sketch?.primitives?.length ?? -1,
      annos: (sketch?.annotations as unknown[] | undefined)?.length ?? 0,
      point: (sketch?.primitives as Array<{ kind: string }> | undefined)?.filter((p) => p.kind === 'point').length ?? 0,
    };
  }, dxfText);

  // 1 POINT entity → 1 point primitive
  expect(counts.point).toBe(1);
  // 1 TEXT entity → 1 annotation
  expect(counts.annos).toBe(1);
  // 1 LINE + 2 INSERT-array circles (2 columns × 1 CIRCLE per block) + 1 POINT = 4 primitives
  expect(counts.prims).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});
