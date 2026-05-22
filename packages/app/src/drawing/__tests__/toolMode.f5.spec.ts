// packages/app/src/drawing/__tests__/toolMode.f5.spec.ts
import { describe, it, expect } from 'vitest';
import type { ToolMode } from '../toolMode';

describe('ToolMode F5 — new union values', () => {
  it('accepts "baseline" as a valid ToolMode', () => {
    const m: ToolMode = 'baseline';
    expect(m).toBe('baseline');
  });

  it('accepts "ordinate" as a valid ToolMode', () => {
    const m: ToolMode = 'ordinate';
    expect(m).toBe('ordinate');
  });

  it('accepts "angular" as a valid ToolMode', () => {
    const m: ToolMode = 'angular';
    expect(m).toBe('angular');
  });
});
