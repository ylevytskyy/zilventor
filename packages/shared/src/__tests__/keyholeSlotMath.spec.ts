import { describe, it, expect } from 'vitest';
import { buildKeyholeSlotCutter } from '../keyholeSlotMath';
import type { KeyholeSlotSpec } from '../keyholeSlot';

const dims = { length: 600, width: 400, thickness: 18 };

describe('buildKeyholeSlotCutter — panel-local cylinder + slot-box cutter geometry', () => {
  it('Top face, axis=u, direction=1: cylinder proud-origin at the hole center, box runs outward from the center', () => {
    // face2DFrame('Top'): origin=(-300,-200,18), uDir=+X, vDir=+Y, normal=+Z (outward).
    // Hole center P = origin + u*uDir + v*vDir = (-300+200, -200+150, 18) = (-100,-50,18).
    const spec: KeyholeSlotSpec = {
      faceRole: 'Top', u: 200, v: 150, axis: 'u', direction: 1,
      entryDiameter: 15, slotWidth: 15, slotLength: 25, depth: 6,
    };
    const cutter = buildKeyholeSlotCutter(dims, spec);

    // Cylinder: origin = P + OVERCUT(0.1)*normal(+Z) = (-100,-50,18.1); axis into
    // material = -normal = (0,0,-1); length = depth+OVERCUT = 6.1.
    expect(cutter.cylinderOrigin.x).toBeCloseTo(-100, 6);
    expect(cutter.cylinderOrigin.y).toBeCloseTo(-50, 6);
    expect(cutter.cylinderOrigin.z).toBeCloseTo(18.1, 6);
    expect(cutter.cylinderAxis.x).toBeCloseTo(0, 6);
    expect(cutter.cylinderAxis.y).toBeCloseTo(0, 6);
    expect(cutter.cylinderAxis.z).toBeCloseTo(-1, 6);
    expect(cutter.cylinderDiameter).toBe(15);
    expect(cutter.cylinderLength).toBeCloseTo(6.1, 6);

    // Slot box: run axis u, runA=u=200 (AT the hole center, not centered on it),
    // runB=200+1*25=225. Cross axis v, centered at v=150, halfWidth=7.5 -> [142.5,157.5].
    // n: OVERCUT(0.1) proud .. -depth(6) into panel.
    const { p1, p2 } = cutter.slotBox;
    const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
    const yMin = Math.min(p1.y, p2.y), yMax = Math.max(p1.y, p2.y);
    const zMin = Math.min(p1.z, p2.z), zMax = Math.max(p1.z, p2.z);
    expect(xMin).toBeCloseTo(-100, 6); // x = -300+u -> u:200 -> -100
    expect(xMax).toBeCloseTo(-75, 6);  // u:225 -> -75
    expect(yMin).toBeCloseTo(-57.5, 6); // y = -200+v -> v:142.5 -> -57.5
    expect(yMax).toBeCloseTo(-42.5, 6); // v:157.5 -> -42.5
    expect(zMin).toBeCloseTo(12, 6);   // n=-depth(6) -> z=18-6=12
    expect(zMax).toBeCloseTo(18.1, 6); // n=OVERCUT(0.1) -> z=18.1
  });

  it('Top face, axis=u, direction=-1: the slot box runs backward (toward -u) from the hole center', () => {
    const spec: KeyholeSlotSpec = {
      faceRole: 'Top', u: 200, v: 150, axis: 'u', direction: -1,
      entryDiameter: 15, slotWidth: 15, slotLength: 25, depth: 6,
    };
    const cutter = buildKeyholeSlotCutter(dims, spec);
    const { p1, p2 } = cutter.slotBox;
    const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
    // runA=u=200 (hole center) -> x=-100; runB=200-25=175 -> x=-125.
    expect(xMin).toBeCloseTo(-125, 6);
    expect(xMax).toBeCloseTo(-100, 6);
  });

  it('Left side face, axis=v, direction=1: cylinder axis points inward (+X) and the slot box runs along the width', () => {
    // face2DFrame('Left'): origin=(-300,-200,0), uDir=+Z, vDir=+Y, normal=-X (outward).
    // Hole center P = origin + u*uDir + v*vDir = (-300, -200+100, 0+9) = (-300,-100,9).
    const spec: KeyholeSlotSpec = {
      faceRole: 'Left', u: 9, v: 100, axis: 'v', direction: 1,
      entryDiameter: 10, slotWidth: 6, slotLength: 20, depth: 5,
    };
    const cutter = buildKeyholeSlotCutter(dims, spec);

    // Cylinder: origin = P + OVERCUT*normal(-X) = (-300.1,-100,9); axis into
    // material = -normal = (1,0,0); length = depth+OVERCUT = 5.1.
    expect(cutter.cylinderOrigin.x).toBeCloseTo(-300.1, 6);
    expect(cutter.cylinderOrigin.y).toBeCloseTo(-100, 6);
    expect(cutter.cylinderOrigin.z).toBeCloseTo(9, 6);
    expect(cutter.cylinderAxis.x).toBeCloseTo(1, 6);
    expect(cutter.cylinderAxis.y).toBeCloseTo(0, 6);
    expect(cutter.cylinderAxis.z).toBeCloseTo(0, 6);
    expect(cutter.cylinderLength).toBeCloseTo(5.1, 6);

    // Slot box: run axis v, runA=v=100, runB=100+1*20=120. Cross axis u, centered
    // at u=9, halfWidth=3 -> [6,12]. n: OVERCUT(0.1) proud (-X direction) .. -depth(5).
    const { p1, p2 } = cutter.slotBox;
    const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
    const yMin = Math.min(p1.y, p2.y), yMax = Math.max(p1.y, p2.y);
    const zMin = Math.min(p1.z, p2.z), zMax = Math.max(p1.z, p2.z);
    expect(xMin).toBeCloseTo(-300.1, 6); // n=OVERCUT -> x = -300 + 0.1*(-1) = -300.1
    expect(xMax).toBeCloseTo(-295, 6);   // n=-depth(5) -> x = -300 - 5*(-1) = -295
    expect(yMin).toBeCloseTo(-100, 6);   // y = -200+v -> v:100 -> -100
    expect(yMax).toBeCloseTo(-80, 6);    // v:120 -> -80
    expect(zMin).toBeCloseTo(6, 6);      // z = 0+u -> u:6
    expect(zMax).toBeCloseTo(12, 6);     // u:12
  });
});
