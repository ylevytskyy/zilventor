import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

// DXF fixture containing two HATCH entities:
//
// HATCH 1 — POLYLINE boundary loop (pathType 2):
//   4 vertices forming a 100×100 closed square.
//   expandPolyline(4 verts, closed=true) → 4 construction line segments.
//
// HATCH 2 — EDGE loop (pathType 0):
//   2 edges: 1 line edge + 1 circular arc edge.
//   expandHatch edge path → 1 construction line + 1 construction arc.
//
// Total expected: 5 construction lines + 1 construction arc = 6 construction primitives.
const DXF = [
  '  0', 'SECTION', '  2', 'ENTITIES',

  // --- HATCH 1: polyline boundary loop (pathType=2 → bit 1 set) ---
  '  0', 'HATCH',
  '  8', '0',
  // 91 = boundary path count
  ' 91', '1',
  // 92 = path type flags (2 = polyline boundary)
  ' 92', '2',
  // 72 = has-bulge flag (0 = no bulge)
  ' 72', '0',
  // 73 = is-closed (1 = closed)
  ' 73', '1',
  // 93 = vertex count
  ' 93', '4',
  // vertex 0
  ' 10', '0.0',   ' 20', '0.0',
  // vertex 1
  ' 10', '100.0', ' 20', '0.0',
  // vertex 2
  ' 10', '100.0', ' 20', '100.0',
  // vertex 3
  ' 10', '0.0',   ' 20', '100.0',
  // 97 = source boundary objects count (0)
  ' 97', '0',

  // --- HATCH 2: edge boundary loop (pathType=0 → edge list) ---
  '  0', 'HATCH',
  '  8', '0',
  // 91 = boundary path count
  ' 91', '1',
  // 92 = path type flags (0 = edge list)
  ' 92', '0',
  // 93 = edge count
  ' 93', '2',
  // edge 1: line (type=1): 10 x1, 20 y1, 11 x2, 21 y2
  ' 72', '1',
  ' 10', '200.0', ' 20', '0.0',
  ' 11', '250.0', ' 21', '0.0',
  // edge 2: circular arc (type=2): 10 cx, 20 cy, 40 r, 50 startAngle, 51 endAngle, 73 ccw
  ' 72', '2',
  ' 10', '225.0', ' 20', '0.0',
  ' 40', '25.0',
  ' 50', '0.0',
  ' 51', '180.0',
  ' 73', '1',
  // 97 = source boundary objects count (0)
  ' 97', '0',

  '  0', 'ENDSEC', '  0', 'EOF',
].join('\n');

test('Phase 4c: HATCH polyline loop + edge loop import (5 construction lines, 1 construction arc)', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  const result = await page.evaluate(async (text: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; construction?: boolean }> }> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'hatch-import.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState();
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    const primitives = sketch?.primitives ?? [];
    return {
      primCount: primitives.length,
      lineCount: primitives.filter((p) => p.kind === 'line').length,
      arcCount: primitives.filter((p) => p.kind === 'arc').length,
      allConstruction: primitives.every((p) => p.construction === true),
    };
  }, DXF);

  // Polyline loop: 4-vertex closed square → 4 construction lines
  // Edge loop: 1 line edge + 1 arc edge → 1 construction line + 1 construction arc
  // Total: 5 lines + 1 arc = 6 primitives, all construction
  expect(result.lineCount).toBe(5);
  expect(result.arcCount).toBe(1);
  expect(result.primCount).toBe(6);
  expect(result.allConstruction).toBe(true);
  expect(errors).toEqual([]);
});
