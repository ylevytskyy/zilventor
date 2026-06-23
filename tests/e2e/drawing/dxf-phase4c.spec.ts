import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

// DXF fixture: block MYBLK contains an ARC at (3,4) r=2 from 30°→120°.
// INSERT places MYBLK at origin with rotation=90°.
// Expected transform: center (3,4) rotated 90° → (-4, 3).
// Arc angles: startAngle = 30°+90° = 120° = 2π/3; endAngle = 120°+90° = 210° = 7π/6.
// A top-level TEXT entity is also present so the annotation path is exercised
// independently of INSERT-annotation transforms (out of scope for Phase 4c).
const DXF = `0
SECTION
2
BLOCKS
0
BLOCK
8
0
2
MYBLK
10
0.0
20
0.0
0
ARC
8
0
10
3.0
20
4.0
40
2.0
50
30.0
51
120.0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
8
0
2
MYBLK
10
0.0
20
0.0
41
1.0
42
1.0
50
90.0
0
TEXT
8
0
10
1.0
20
1.0
40
2.5
1
HELLO
50
0.0
0
ENDSEC
0
EOF
`;

test('Phase 4c: rotated INSERT arc transform + text annotation import', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  const result = await page.evaluate(async (text: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; cx?: number; cy?: number; startAngle?: number; endAngle?: number }>; annotations?: unknown[] }> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'phase4c.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState();
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    const arc = sketch?.primitives?.find((p) => p.kind === 'arc');
    return {
      arcCx: arc?.cx,
      arcCy: arc?.cy,
      arcStart: arc?.startAngle,
      arcEnd: arc?.endAngle,
      annCount: (sketch?.annotations ?? []).length,
    };
  }, DXF);

  // Arc center (3, 4) rotated 90° CCW → (-4, 3)
  expect(result.arcCx).toBeCloseTo(-4, 3);
  expect(result.arcCy).toBeCloseTo(3, 3);
  // Arc start angle: 30° + 90° rotation = 120° = 2π/3
  expect(result.arcStart).toBeCloseTo((2 * Math.PI) / 3, 3);
  // Arc end angle: 120° + 90° rotation = 210° = 7π/6
  expect(result.arcEnd).toBeCloseTo((7 * Math.PI) / 6, 3);
  // TEXT entity carried as annotation
  expect(result.annCount).toBeGreaterThanOrEqual(1);

  expect(errors).toEqual([]);
});
