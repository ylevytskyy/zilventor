import { describe, it, expect } from 'vitest';
import { face2DFrame, generateConfirmat, generateMinifix, generateDowel } from '../index';

describe('shared barrel re-exports присадка surface', () => {
  it('exposes face2DFrame + connector generators', () => {
    expect(typeof face2DFrame).toBe('function');
    expect(typeof generateConfirmat).toBe('function');
    expect(typeof generateMinifix).toBe('function');
    expect(typeof generateDowel).toBe('function');
  });
});
