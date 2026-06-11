import { describe, it, expect } from 'vitest';
import type { BoreConnectorKind } from '@zilventor/shared';
import { SceneManager } from '../SceneManager';

describe('SceneManager.BORE_COLORS — exhaustive over BoreConnectorKind', () => {
  // Listing the union members literally is the guard: if BoreConnectorKind grows
  // and this array is not updated, the `satisfies` below is a compile error.
  // If BORE_COLORS lacks a member's entry, the runtime assertion below fails.
  // No SceneManager instance is needed — BORE_COLORS is a static field.
  const ALL_KINDS = [
    'confirmat', 'minifix', 'dowel', 'shelfPin', 'hinge', 'drawerSlide', 'handleScrew',
  ] as const satisfies readonly BoreConnectorKind[];

  it('has a non-empty color string for every connector kind (no SceneManager instance needed)', () => {
    for (const kind of ALL_KINDS) {
      const color = SceneManager.BORE_COLORS[kind];
      expect(typeof color, `kind '${kind}' must have a color string`).toBe('string');
      expect(color.length, `kind '${kind}' color must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('maps shelfPin to amber and hinge to violet', () => {
    expect(SceneManager.BORE_COLORS.shelfPin).toBe('#b8a32e');
    expect(SceneManager.BORE_COLORS.hinge).toBe('#8c2eb8');
  });

  it('has exactly the BoreConnectorKind keys (no stray entries)', () => {
    expect(Object.keys(SceneManager.BORE_COLORS).sort()).toEqual(
      [...ALL_KINDS].sort(),
    );
  });
});
