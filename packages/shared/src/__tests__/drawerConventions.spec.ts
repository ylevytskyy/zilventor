import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as C from '../drawerConventions';

describe('drawerConventions', () => {
  it('exposes the locked constants', () => {
    expect(C.SLIDE_CLEARANCE_PER_SIDE).toBe(12.5);
    expect(C.BOX_PANEL_THICKNESS).toBe(16);
    expect(C.BOX_BOTTOM_THICKNESS).toBe(12);
    expect(C.BOX_VERT_CLEARANCE).toBe(12);
    expect(C.BOX_BACK_CLEARANCE).toBe(10);
    expect(C.DRAWER_FRONT_GAP).toBe(3);
    expect(C.DRAWER_FRONT_THICKNESS).toBe(18);
    expect(C.SLIDE_GRID_PITCH).toBe(32);
    expect(C.DRAWER_SLIDE_FRONT_SETBACK).toBe(37);
    expect(C.DRAWER_SLIDE_HOLE_DIAMETER).toBe(5);
    expect(C.DRAWER_SLIDE_HOLE_DEPTH).toBe(12);
  });
  it('no bare drawer literals re-declared outside drawerConventions.ts', () => {
    // grep for the named constants being re-assigned elsewhere
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    const out = execSync(
      `git grep -nE '^[[:space:]]*(export[[:space:]]+)?(const|let|var)[[:space:]]+(SLIDE_CLEARANCE_PER_SIDE|BOX_VERT_CLEARANCE|DRAWER_FRONT_GAP|DRAWER_SLIDE_FRONT_SETBACK)[[:space:]]*=' -- 'packages/' ':!packages/shared/src/drawerConventions.ts' || true`,
      { cwd: repoRoot, encoding: 'utf8' }
    );
    expect(out.trim()).toBe('');
  });
});
