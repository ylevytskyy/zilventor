import { describe, it, expect } from 'vitest';
import { CARCASS_ROLES } from '../clash';

describe('clash: face-frame roles', () => {
  it('classifies face-frame members as NON-carcass (kept, like doors)', () => {
    expect(CARCASS_ROLES.has('faceFrameStile')).toBe(false);
    expect(CARCASS_ROLES.has('faceFrameRail')).toBe(false);
    expect(CARCASS_ROLES.has('door')).toBe(false); // sanity: same class as doors
  });
});
