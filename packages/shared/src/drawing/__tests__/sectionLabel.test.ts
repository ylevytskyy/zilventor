// packages/shared/src/drawing/__tests__/sectionLabel.test.ts
import { describe, it, expect } from 'vitest';
import { allocateSectionLabel } from '../sectionLabel';

describe('allocateSectionLabel', () => {
  it('empty labels → A', () => {
    expect(allocateSectionLabel([])).toBe('A');
  });

  it('[A] → B', () => {
    expect(allocateSectionLabel(['A'])).toBe('B');
  });

  it('[A, B] → C', () => {
    expect(allocateSectionLabel(['A', 'B'])).toBe('C');
  });

  it('skips I: after H → J', () => {
    expect(allocateSectionLabel(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toBe('J');
  });

  it('skips O: after N → P', () => {
    expect(allocateSectionLabel(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N'])).toBe('P');
  });

  it('gap reuse: [A, C] → B', () => {
    expect(allocateSectionLabel(['A', 'C'])).toBe('B');
  });

  it('all 24 single letters used → AA', () => {
    // A-Z minus I, O = 24 letters
    const all24 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');
    expect(all24).toHaveLength(24);
    expect(allocateSectionLabel(all24)).toBe('AA');
  });

  it('after AH → AJ (skip AI)', () => {
    const used = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').map((c) => 'A' + c);
    // used = AA, AB, ..., AH (stopping before AI which is skipped)
    const upToAH = used.slice(0, used.indexOf('AJ')); // AA..AH
    expect(allocateSectionLabel(upToAH)).toBe('AJ');
  });

  it('after AN → AP (skip AO)', () => {
    const usedPrefix = ['AA','AB','AC','AD','AE','AF','AG','AH','AJ','AK','AL','AM','AN'];
    expect(allocateSectionLabel(usedPrefix)).toBe('AP');
  });

  it('after AZ → BA', () => {
    const allA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').map((c) => 'A' + c);
    expect(allocateSectionLabel(allA)).toBe('BA');
  });
});
