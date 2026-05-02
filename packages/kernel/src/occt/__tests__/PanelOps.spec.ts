import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct } from '../occtLoader';
import { buildPanelBox } from '../PanelOps';

let occt: Awaited<ReturnType<typeof loadOcct>>;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('buildPanelBox', () => {
  it('creates an axis-aligned box of the requested L x W x T', () => {
    const r = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    expect(r.bbox).toEqual([
      -300, -200, 0,
       300,  200, 18,
    ]);
  });

  it('produces 6 faces and 12 edges', () => {
    const r = buildPanelBox(occt, { length: 100, width: 50, thickness: 10 });
    expect(r.faceNames).toHaveProperty('Top');
    expect(r.faceNames).toHaveProperty('Bottom');
    expect(r.faceNames).toHaveProperty('Front');
    expect(r.faceNames).toHaveProperty('Back');
    expect(r.faceNames).toHaveProperty('Left');
    expect(r.faceNames).toHaveProperty('Right');
    expect(Object.keys(r.edgeNames)).toEqual(
      expect.arrayContaining(['front', 'back', 'left', 'right'])
    );
  });

  it('rejects non-positive dimensions', () => {
    expect(() => buildPanelBox(occt, { length: 0, width: 100, thickness: 10 }))
      .toThrow(/positive/);
    expect(() => buildPanelBox(occt, { length: 100, width: -1, thickness: 10 }))
      .toThrow(/positive/);
  });

  it('top-rim edge ids map to four distinct OCCT edges', () => {
    const r = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    const ids = Object.values(r.edgeNames);
    expect(new Set(ids).size).toBe(4);
  });
});
