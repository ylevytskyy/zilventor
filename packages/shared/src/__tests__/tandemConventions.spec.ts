import { describe, it, expect } from 'vitest';
import {
  TANDEM_SLIDE_CLEARANCE_PER_SIDE,
  TANDEM_CABINET_FRONT_SETBACK,
  TANDEM_CABINET_REAR_HOLE_FROM_BACK,
  TANDEM_CABINET_RUNNER_HEIGHT,
  TANDEM_CABINET_HOLE_DIAMETER,
  TANDEM_LOCK_HOLE_DIAMETER,
  TANDEM_REAR_HOOK_FROM_BACK,
  TANDEM_BOTTOM_HOLE_DIAMETER,
  TANDEM_HOLE_DEPTH,
  TANDEM_MIN_HOLES,
} from '../tandemConventions';

describe('tandemConventions', () => {
  it('all nominal constants are present and have correct values', () => {
    expect(TANDEM_SLIDE_CLEARANCE_PER_SIDE).toBe(21);
    expect(TANDEM_CABINET_FRONT_SETBACK).toBe(37);
    expect(TANDEM_CABINET_REAR_HOLE_FROM_BACK).toBe(9);
    expect(TANDEM_CABINET_RUNNER_HEIGHT).toBe(10);
    expect(TANDEM_CABINET_HOLE_DIAMETER).toBe(5);
    expect(TANDEM_LOCK_HOLE_DIAMETER).toBe(10);
    expect(TANDEM_REAR_HOOK_FROM_BACK).toBe(9);
    expect(TANDEM_BOTTOM_HOLE_DIAMETER).toBe(5);
    expect(TANDEM_HOLE_DEPTH).toBe(12);
    expect(TANDEM_MIN_HOLES).toBe(2);
  });
});
