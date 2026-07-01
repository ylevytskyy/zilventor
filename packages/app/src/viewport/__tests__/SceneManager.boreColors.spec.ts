import { describe, it, expect } from 'vitest';
import type { BoreConnectorKind } from '@zilventor/shared';
import { SceneManager } from '../SceneManager';

describe('SceneManager.BORE_COLORS — exhaustive over BoreConnectorKind', () => {
  // A Record keyed by the union is the guard: if BoreConnectorKind grows and
  // this object is not updated, the annotation below is a compile error
  // (a `satisfies readonly BoreConnectorKind[]` array is NOT exhaustive — that
  // is how legLeveler/tandem slipped through unnoticed).
  // If BORE_COLORS lacks a member's entry, the runtime assertion below fails.
  // No SceneManager instance is needed — BORE_COLORS is a static field.
  const KINDS_EXHAUSTIVE: Record<BoreConnectorKind, 0> = {
    confirmat: 0, minifix: 0, dowel: 0, shelfPin: 0, hinge: 0,
    drawerSlide: 0, handleScrew: 0, legLeveler: 0, tandem: 0,
  };
  const ALL_KINDS = Object.keys(KINDS_EXHAUSTIVE) as BoreConnectorKind[];

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
