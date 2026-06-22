import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

// Phase 4c branch-cut fix: a trimmed ELLIPSE whose start/end params straddle the
// parameter seam (raw endParam < startParam) must import as the CCW SHORT arc, not
// the complementary (wrong, long) arc.
//
// Fixture ellipse: center (0,0), major axis vector (4,0) → rx=4, ratio 0.5 → ry=2,
// rotation 0. startParam=5.5 rad, endParam=0.5 rad.
//   Correct CCW sweep: 0.5 + 2π ≈ 6.783 from 5.5  →  span ≈ 1.283 rad < π (SHORT).
//   Without the fix endAngle (0.5) < startAngle (5.5) → renders the long complement.

// Test A: plain top-level ELLIPSE crossing the seam.
const DXF_PLAIN = `0
SECTION
2
ENTITIES
0
ELLIPSE
8
0
10
0.0
20
0.0
11
4.0
21
0.0
40
0.5
41
5.5
42
0.5
0
ENDSEC
0
EOF
`;

// Test B: same ELLIPSE inside a BLOCK, referenced by an INSERT rotated 30°.
const DXF_INSERT = `0
SECTION
2
BLOCKS
0
BLOCK
8
0
2
ELBLK
10
0.0
20
0.0
0
ELLIPSE
8
0
10
0.0
20
0.0
11
4.0
21
0.0
40
0.5
41
5.5
42
0.5
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
ELBLK
10
0.0
20
0.0
41
1.0
42
1.0
50
30.0
0
ENDSEC
0
EOF
`;

type EllipseProbe = {
  count: number;
  startAngle?: number;
  endAngle?: number;
  rx?: number;
  ry?: number;
};

async function importAndProbeEllipse(
  page: import('@playwright/test').Page,
  text: string,
): Promise<EllipseProbe> {
  return page.evaluate(async (dxf: string) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState: () => {
          activePart?: {
            featureTree: Array<{
              kind: string;
              primitives?: Array<{
                kind: string;
                startAngle?: number;
                endAngle?: number;
                rx?: number;
                ry?: number;
              }>;
            }>;
          };
        };
      };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([dxf], 'ellipse-branchcut.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState();
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    const ellipses = (sketch?.primitives ?? []).filter((p) => p.kind === 'ellipse');
    const e = ellipses[0];
    return {
      count: ellipses.length,
      startAngle: e?.startAngle,
      endAngle: e?.endAngle,
      rx: e?.rx,
      ry: e?.ry,
    };
  }, text);
}

test('Phase 4c: plain cut-straddling trimmed ELLIPSE imports as CCW short arc', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  const r = await importAndProbeEllipse(page, DXF_PLAIN);

  expect(r.count).toBe(1);
  expect(r.startAngle).toBeDefined();
  expect(r.endAngle).toBeDefined();
  // CCW ordering restored: end ≥ start.
  expect(r.endAngle!).toBeGreaterThanOrEqual(r.startAngle!);
  // Short arc: swept span < π (the fix avoids the complementary long arc).
  expect(r.endAngle! - r.startAngle!).toBeLessThan(Math.PI);
  // start param preserved verbatim; end normalized to start + 2π wrap.
  expect(r.startAngle!).toBeCloseTo(5.5, 6);
  expect(r.endAngle!).toBeCloseTo(0.5 + 2 * Math.PI, 6);
  // Radii from major-axis (4,0) and ratio 0.5.
  expect(r.rx!).toBeCloseTo(4, 6);
  expect(r.ry!).toBeCloseTo(2, 6);

  expect(errors).toEqual([]);
});

// Note: under a rotated INSERT the angles are recovered via Rytz mapParam (atan2),
// which already normalizes both endpoints into (-π,π]; this test asserts the
// end-to-end user-visible outcome (correct CCW short arc through INSERT) rather
// than isolating the plain-path `while`-wrap fix exercised by Test A.
test('Phase 4c: cut-straddling trimmed ELLIPSE inside a rotated INSERT imports as CCW short arc', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await waitForKernelReady(page);

  const r = await importAndProbeEllipse(page, DXF_INSERT);

  expect(r.count).toBe(1);
  expect(r.startAngle).toBeDefined();
  expect(r.endAngle).toBeDefined();
  // CCW ordering restored after the INSERT (Rytz) transform.
  expect(r.endAngle!).toBeGreaterThanOrEqual(r.startAngle!);
  // Short arc preserved through the rotated INSERT.
  expect(r.endAngle! - r.startAngle!).toBeLessThan(Math.PI);

  expect(errors).toEqual([]);
});
