import { describe, it, expect } from 'vitest';
import { BUILTIN_CATALOG } from './builtinCatalog';

describe('BUILTIN_CATALOG', () => {
  it('has exactly 17 entries', () => {
    expect(BUILTIN_CATALOG).toHaveLength(17);
  });

  it('all ids are unique', () => {
    const ids = BUILTIN_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(17);
  });

  it('has 4 hinge entries, 3 shelf-pin entries, and 3 bar-pull entries', () => {
    const hinges = BUILTIN_CATALOG.filter((e) => e.category === 'hinges');
    const pins   = BUILTIN_CATALOG.filter((e) => e.category === 'shelfPins');
    const pulls  = BUILTIN_CATALOG.filter((e) => e.category === 'drawerHandles');
    expect(hinges).toHaveLength(4);
    expect(pins).toHaveLength(3);
    expect(pulls).toHaveLength(3);
  });

  it('has 4 drawer-slide, 1 leg-leveler, and 2 soft-close-hinge entries (1b.5 + tandem M4-C)', () => {
    const slides   = BUILTIN_CATALOG.filter((e) => e.category === 'drawerSlides');
    const levelers = BUILTIN_CATALOG.filter((e) => e.category === 'legLevelers');
    const softHinges = BUILTIN_CATALOG.filter((e) => e.category === 'softCloseHinges');
    expect(slides).toHaveLength(4);
    expect(levelers).toHaveLength(1);
    expect(softHinges).toHaveLength(2);
  });

  it('every entry has a non-empty name and non-empty notes', () => {
    for (const e of BUILTIN_CATALOG) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.notes.length).toBeGreaterThan(0);
    }
  });

  it('all bbox dims are positive numbers', () => {
    for (const e of BUILTIN_CATALOG) {
      expect(e.bboxMm.l).toBeGreaterThan(0);
      expect(e.bboxMm.w).toBeGreaterThan(0);
      expect(e.bboxMm.h).toBeGreaterThan(0);
    }
  });

  it('all attach-point positions are finite numbers', () => {
    for (const e of BUILTIN_CATALOG) {
      for (const ap of e.attachPoints) {
        expect(Number.isFinite(ap.position.x)).toBe(true);
        expect(Number.isFinite(ap.position.y)).toBe(true);
        expect(Number.isFinite(ap.position.z)).toBe(true);
      }
    }
  });

  it('hinge-35mm-cup-full has 2 attach points: cup-center and arm-mount', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'hinge-35mm-cup-full')!;
    expect(entry.attachPoints.map((a) => a.name)).toEqual(['cup-center', 'arm-mount']);
    expect(entry.attachPoints[0]!.position).toEqual({ x: 0, y: 17.5, z: 0 });
    expect(entry.attachPoints[1]!.position).toEqual({ x: 48, y: 17.5, z: 0 });
  });

  it('shelf-pin-5mm-steel has 1 attach point: tip at z=14', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'shelf-pin-5mm-steel')!;
    expect(entry.attachPoints).toHaveLength(1);
    expect(entry.attachPoints[0]!.name).toBe('tip');
    expect(entry.attachPoints[0]!.position).toEqual({ x: 0, y: 0, z: 14 });
  });
});
