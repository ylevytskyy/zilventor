// TDD guard: ensures faceFrameConventions.ts exports the full set of constants
// required by spec §10 (single source of truth, git-grep-gated zero re-declaration).
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STILE_WIDTH,
  DEFAULT_RAIL_WIDTH,
  DEFAULT_FRAME_THICKNESS,
  FACE_FRAME_PROUD,
  ROLE_FACE_FRAME_STILE,
  ROLE_FACE_FRAME_RAIL,
  GRAIN_STILE,
  GRAIN_RAIL,
} from '../faceFrameConventions';

describe('faceFrameConventions — spec §10 constants', () => {
  it('has the three numeric defaults', () => {
    expect(DEFAULT_STILE_WIDTH).toBe(38);
    expect(DEFAULT_RAIL_WIDTH).toBe(38);
    expect(DEFAULT_FRAME_THICKNESS).toBe(19);
  });

  it('FACE_FRAME_PROUD = 0 (flush proud offset — member sits on the front face)', () => {
    expect(FACE_FRAME_PROUD).toBe(0);
  });

  it('role string constants match the PanelRole values used in the plan', () => {
    expect(ROLE_FACE_FRAME_STILE).toBe('faceFrameStile');
    expect(ROLE_FACE_FRAME_RAIL).toBe('faceFrameRail');
  });

  it('grain convention constants match the GrainDirection values used in the plan', () => {
    expect(GRAIN_STILE).toBe('length');
    expect(GRAIN_RAIL).toBe('width');
  });
});
