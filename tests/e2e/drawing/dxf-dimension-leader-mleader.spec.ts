import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

// Combined DXF fixture for Phase 4c integration:
//
// BLOCKS section:
//   *D1: 1 LINE + 1 SOLID (4-corner arrowhead) + 1 MTEXT('100')
//
// ENTITIES section:
//   DIMENSION  → block *D1  → expandInsert produces: 1 LINE + 4 SOLID-loop lines = 5 lines
//                           → block MTEXT scan emits:  1 annotation
//   SOLID (standalone quad) → 4 construction lines
//   LEADER (3 vertices)     → 2 construction line segments, 0 annotations
//   MLEADER (1 leader line, 2 vertices) + embedded mtext
//                           → 1 construction line segment, 1 annotation
//
// Total expected: 5 + 4 + 2 + 1 = 12 line primitives, 2 annotations.
const DXF = `  0
SECTION
  2
BLOCKS
  0
BLOCK
  2
*D1
 70
0
 10
0.0
 20
0.0
  0
LINE
  8
0
 10
0.0
 20
0.0
 11
10.0
 21
0.0
  0
SOLID
  8
0
 10
9.0
 20
-0.5
 11
10.0
 21
-0.5
 12
9.0
 22
0.5
 13
10.0
 23
0.5
  0
MTEXT
  8
0
 10
5.0
 20
1.0
 40
2.5
  1
100
 50
0.0
  0
ENDBLK
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
DIMENSION
  8
DIMENSIONS
  2
*D1
  1
<>
 42
100.0
 11
5.0
 21
1.0
  0
SOLID
  8
0
 10
20.0
 20
0.0
 11
25.0
 21
0.0
 12
20.0
 22
5.0
 13
25.0
 23
5.0
  0
LEADER
  8
0
 10
30.0
 20
0.0
 10
35.0
 20
5.0
 10
40.0
 20
5.0
  0
MLEADER
  8
0
300
CONTEXT_DATA{
290
1
304
Ref A
 12
45.0
 22
5.0
 41
2.5
 42
0.0
302
LEADER{
304
LEADER_LINE{
 10
42.0
 20
0.0
 10
45.0
 20
5.0
305
}
303
}
301
}
  0
ENDSEC
  0
EOF
`;

test('Phase 4c: combined DIMENSION/SOLID/LEADER/MLEADER import (12 lines, 2 annotations)', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  const result = await page.evaluate(async (text: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; construction?: boolean }>; annotations?: unknown[] }> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'dim-leader-mleader.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState();
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    const primitives = sketch?.primitives ?? [];
    const annotations = sketch?.annotations ?? [];
    return {
      lineCount: primitives.filter((p) => p.kind === 'line').length,
      annCount: annotations.length,
      primCount: primitives.length,
    };
  }, DXF);

  // DIMENSION block (*D1): 1 LINE + 4 SOLID-loop lines = 5
  // Standalone SOLID quad: 4 lines
  // LEADER (3 verts): 2 lines
  // MLEADER (1 leader line, 2 verts): 1 line
  // Total: 5 + 4 + 2 + 1 = 12 line primitives
  expect(result.lineCount).toBe(12);

  // DIMENSION block MTEXT annotation: 1
  // MLEADER embedded mtext: 1
  // Total: 2 annotations
  expect(result.annCount).toBe(2);

  expect(errors).toEqual([]);
});
