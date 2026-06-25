import { describe, it, expect } from 'vitest';
import { BUILTIN_CATALOG } from '../hardware/builtinCatalog';

describe('builtinCatalog — TANDEM SKU', () => {
  it('drawer-slide-tandem-500 is present with correct shape', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'drawer-slide-tandem-500');
    expect(entry, 'drawer-slide-tandem-500 must be in BUILTIN_CATALOG').toBeDefined();
    expect(entry!.category).toBe('drawerSlides');
    expect(entry!.vendor).toBe('Blum');
    // Under-mount: l ≈ 42 mm (2 × TANDEM_SLIDE_CLEARANCE_PER_SIDE), w = 500 mm run
    expect(entry!.bboxMm.l).toBe(42);
    expect(entry!.bboxMm.w).toBe(500);
    expect(entry!.attachPoints.find((p) => p.name === 'front')).toBeDefined();
    expect(entry!.attachPoints.find((p) => p.name === 'back')).toBeDefined();
  });
});
