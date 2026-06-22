import { test, expect } from '@playwright/test';
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
