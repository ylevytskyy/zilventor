// packages/shared/src/drawing/__tests__/deriveProjectedOrientation.spec.ts
import { describe, it, expect } from 'vitest';
import { deriveProjectedOrientation } from '../deriveProjectedOrientation';

// Third-angle projection (ANSI): when looking at the FRONT view,
//   'top'    neighbour = view from ABOVE    → 'top'
//   'bottom' neighbour = view from BELOW    → 'bottom'
//   'right'  neighbour = view from RIGHT    → 'right'
//   'left'   neighbour = view from LEFT     → 'left'
//
// When the base view IS the top view, the 'top' neighbour is 'back',
// 'bottom' is 'front', 'right' is 'right', 'left' is 'left'.
//
// Full third-angle table (6 base orientations × 4 directions = 24 cases):

describe('deriveProjectedOrientation', () => {
  // Front base
  it('front + top    → top',    () => expect(deriveProjectedOrientation('front',  'top'   )).toBe('top'));
  it('front + bottom → bottom', () => expect(deriveProjectedOrientation('front',  'bottom')).toBe('bottom'));
  it('front + right  → right',  () => expect(deriveProjectedOrientation('front',  'right' )).toBe('right'));
  it('front + left   → left',   () => expect(deriveProjectedOrientation('front',  'left'  )).toBe('left'));

  // Top base (looking down from above)
  it('top + top    → back',    () => expect(deriveProjectedOrientation('top',  'top'   )).toBe('back'));
  it('top + bottom → front',   () => expect(deriveProjectedOrientation('top',  'bottom')).toBe('front'));
  it('top + right  → right',   () => expect(deriveProjectedOrientation('top',  'right' )).toBe('right'));
  it('top + left   → left',    () => expect(deriveProjectedOrientation('top',  'left'  )).toBe('left'));

  // Right base (looking from the right side)
  it('right + top    → top',    () => expect(deriveProjectedOrientation('right',  'top'   )).toBe('top'));
  it('right + bottom → bottom', () => expect(deriveProjectedOrientation('right',  'bottom')).toBe('bottom'));
  it('right + right  → back',   () => expect(deriveProjectedOrientation('right',  'right' )).toBe('back'));
  it('right + left   → front',  () => expect(deriveProjectedOrientation('right',  'left'  )).toBe('front'));

  // Back base
  it('back + top    → top',    () => expect(deriveProjectedOrientation('back',  'top'   )).toBe('top'));
  it('back + bottom → bottom', () => expect(deriveProjectedOrientation('back',  'bottom')).toBe('bottom'));
  it('back + right  → left',   () => expect(deriveProjectedOrientation('back',  'right' )).toBe('left'));
  it('back + left   → right',  () => expect(deriveProjectedOrientation('back',  'left'  )).toBe('right'));

  // Bottom base
  it('bottom + top    → front',  () => expect(deriveProjectedOrientation('bottom', 'top'   )).toBe('front'));
  it('bottom + bottom → back',   () => expect(deriveProjectedOrientation('bottom', 'bottom')).toBe('back'));
  it('bottom + right  → right',  () => expect(deriveProjectedOrientation('bottom', 'right' )).toBe('right'));
  it('bottom + left   → left',   () => expect(deriveProjectedOrientation('bottom', 'left'  )).toBe('left'));

  // Left base
  it('left + top    → top',    () => expect(deriveProjectedOrientation('left', 'top'   )).toBe('top'));
  it('left + bottom → bottom', () => expect(deriveProjectedOrientation('left', 'bottom')).toBe('bottom'));
  it('left + right  → front',  () => expect(deriveProjectedOrientation('left', 'right' )).toBe('front'));
  it('left + left   → back',   () => expect(deriveProjectedOrientation('left', 'left'  )).toBe('back'));
});
