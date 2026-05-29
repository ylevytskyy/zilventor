// packages/shared/src/drawing/__tests__/deriveProjectedOrientation.spec.ts
import { describe, it, expect } from 'vitest';
import { deriveProjectedOrientation } from '../deriveProjectedOrientation';

// First-angle projection (ISO): when looking at the FRONT view,
//   'top'    neighbour = view from BELOW    → 'bottom'
//   'bottom' neighbour = view from ABOVE    → 'top'
//   'right'  neighbour = view from LEFT     → 'left'
//   'left'   neighbour = view from RIGHT    → 'right'
//
// When the base view IS the top view, the 'top' neighbour is 'front',
// 'bottom' is 'back', 'right' is 'left', 'left' is 'right'.
//
// Full first-angle table (6 base orientations × 4 directions = 24 cases):

describe('deriveProjectedOrientation', () => {
  // Front base
  it('front + top    → bottom', () => expect(deriveProjectedOrientation('front',  'top'   )).toBe('bottom'));
  it('front + bottom → top',    () => expect(deriveProjectedOrientation('front',  'bottom')).toBe('top'));
  it('front + right  → left',   () => expect(deriveProjectedOrientation('front',  'right' )).toBe('left'));
  it('front + left   → right',  () => expect(deriveProjectedOrientation('front',  'left'  )).toBe('right'));

  // Top base (looking down from above)
  it('top + top    → front',  () => expect(deriveProjectedOrientation('top',  'top'   )).toBe('front'));
  it('top + bottom → back',   () => expect(deriveProjectedOrientation('top',  'bottom')).toBe('back'));
  it('top + right  → left',   () => expect(deriveProjectedOrientation('top',  'right' )).toBe('left'));
  it('top + left   → right',  () => expect(deriveProjectedOrientation('top',  'left'  )).toBe('right'));

  // Right base (looking from the right side)
  it('right + top    → bottom', () => expect(deriveProjectedOrientation('right',  'top'   )).toBe('bottom'));
  it('right + bottom → top',    () => expect(deriveProjectedOrientation('right',  'bottom')).toBe('top'));
  it('right + right  → front',  () => expect(deriveProjectedOrientation('right',  'right' )).toBe('front'));
  it('right + left   → back',   () => expect(deriveProjectedOrientation('right',  'left'  )).toBe('back'));

  // Back base
  it('back + top    → bottom', () => expect(deriveProjectedOrientation('back',  'top'   )).toBe('bottom'));
  it('back + bottom → top',    () => expect(deriveProjectedOrientation('back',  'bottom')).toBe('top'));
  it('back + right  → right',  () => expect(deriveProjectedOrientation('back',  'right' )).toBe('right'));
  it('back + left   → left',   () => expect(deriveProjectedOrientation('back',  'left'  )).toBe('left'));

  // Bottom base
  it('bottom + top    → back',   () => expect(deriveProjectedOrientation('bottom', 'top'   )).toBe('back'));
  it('bottom + bottom → front',  () => expect(deriveProjectedOrientation('bottom', 'bottom')).toBe('front'));
  it('bottom + right  → left',   () => expect(deriveProjectedOrientation('bottom', 'right' )).toBe('left'));
  it('bottom + left   → right',  () => expect(deriveProjectedOrientation('bottom', 'left'  )).toBe('right'));

  // Left base
  it('left + top    → bottom', () => expect(deriveProjectedOrientation('left', 'top'   )).toBe('bottom'));
  it('left + bottom → top',    () => expect(deriveProjectedOrientation('left', 'bottom')).toBe('top'));
  it('left + right  → back',   () => expect(deriveProjectedOrientation('left', 'right' )).toBe('back'));
  it('left + left   → front',  () => expect(deriveProjectedOrientation('left', 'left'  )).toBe('front'));
});
