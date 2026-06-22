import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

// ENTITIES-only fixture:
//   LINE   (layer 0)  → 1 NON-construction line
//   3DFACE (planar quad, z=0) → 4 construction lines (closed loop)
//   XLINE  (horizontal, y=2)  → 1 construction line clamped to the LINE+3DFACE bbox
//   RAY    (vertical, +y)     → 1 construction line clamped (t≥0)
// Total: 7 line primitives, of which 6 are construction.
const DXF = [
  '  0', 'SECTION', '  2', 'ENTITIES',
  '  0', 'LINE', '  8', '0', ' 10', '0.0', ' 20', '0.0', ' 11', '10.0', ' 21', '0.0',
  '  0', '3DFACE', '  8', '0',
  ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
  ' 11', '5.0', ' 21', '0.0', ' 31', '0.0',
  ' 12', '5.0', ' 22', '5.0', ' 32', '0.0',
  ' 13', '0.0', ' 23', '5.0', ' 33', '0.0',
  '  0', 'XLINE', '  8', '0', ' 10', '0.0', ' 20', '2.0', ' 11', '1.0', ' 21', '0.0',
  '  0', 'RAY', '  8', '0', ' 10', '0.0', ' 20', '0.0', ' 11', '0.0', ' 21', '1.0',
  '  0', 'ENDSEC', '  0', 'EOF',
].join('\n');

test('Phase 4c: 3DFACE + XLINE + RAY + LINE import (7 lines, 6 construction)', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  const result = await page.evaluate(async (text: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; construction?: boolean }> }> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'face-ray-xline.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState();
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    const primitives = sketch?.primitives ?? [];
    return {
      lineCount: primitives.filter((p) => p.kind === 'line').length,
      constructionLineCount: primitives.filter((p) => p.kind === 'line' && p.construction === true).length,
    };
  }, DXF);

  expect(result.lineCount).toBe(7);
  expect(result.constructionLineCount).toBe(6);
  expect(errors).toEqual([]);
});
