import { describe, it, expect } from 'vitest';
import { tandemSlideMath } from '../tandemSlideMath';
import { face2DFrame } from '../bore';
import {
  TANDEM_CABINET_RUNNER_HEIGHT,
  TANDEM_CABINET_FRONT_SETBACK,
  TANDEM_CABINET_REAR_HOLE_FROM_BACK,
  TANDEM_REAR_HOOK_FROM_BACK,
  TANDEM_CABINET_HOLE_DIAMETER,
  TANDEM_BOTTOM_HOLE_DIAMETER,
  TANDEM_LOCK_HOLE_DIAMETER,
  TANDEM_HOLE_DEPTH,
} from '../tandemConventions';
import { BOX_PANEL_THICKNESS as T } from '../drawerConventions';

// Test fixture — seeded cabinet + box values
const Tc = 18, H = 720, D = 560;
const openBottomZ = 100;
const slotH = 200;
const bh = 176;   // slotH - 2*BOX_VERT_CLEARANCE(12)
const bd = 490;   // box depth
const bw = 564;   // openW - 2*TANDEM_SLIDE_CLEARANCE_PER_SIDE ≈ 606 - 42; pick concrete value

const ctx = {
  drawerIndex: 1,
  openBottomZ,
  slotH,
  bh,
  cabinet: { H, D, Tc },
  box: { bd, bw },
  slideLength: bd,
};

describe('tandemSlideMath', () => {
  const r = tandemSlideMath(ctx);

  // ─── Independent oracle targets ───────────────────────────────────────────────
  // Runner world-Z = openBottomZ + i*slotH + TANDEM_CABINET_RUNNER_HEIGHT
  const runnerWorldZ = openBottomZ + 1 * slotH + TANDEM_CABINET_RUNNER_HEIGHT; // 310
  // Cabinet v positions
  const vFront = TANDEM_CABINET_FRONT_SETBACK;                         // 37
  const vRear  = D - Tc - TANDEM_CABINET_REAR_HOLE_FROM_BACK;          // 533

  it('emits 2 cabinet bores per side (front + rear)', () => {
    const left  = r.cabinetBores.filter((b) => b.face.role === 'Top');
    const right = r.cabinetBores.filter((b) => b.face.role === 'Bottom');
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
  });

  it('cabinet bore u = runnerWorldZ (absolute world-Z) [load-bearing]', () => {
    // Cabinet side panel: length=H, bottom at world-Z=0 → u = world-Z.
    // To verify world position via face2DFrame (same transform viewport uses):
    //   Top face: origin=(-H/2, -D/2, Tc), uDir=(1,0,0), vDir=(0,1,0)
    //   world-X of bore = origin.x + u * uDir.x = -H/2 + u
    //   But for LEFT side panel (role=leftSide) the panel is rotated SIDE_PANEL_QUAT
    //   (part-X→+Z, part-Y→-Y, part-Z→+X). The u-axis of the Top face = part-X → world-Z.
    //   So world-Z of bore = (panel bottom in world) + u_panel.
    //   Panel bottom at world-Z = 0; u_panel = runnerWorldZ.  ← The independent oracle.
    r.cabinetBores.forEach((b) => {
      expect(b.u).toBeCloseTo(runnerWorldZ, 6);
    });
  });

  it('cabinet bore v positions: front=37, rear=D-Tc-9', () => {
    const leftVs = r.cabinetBores
      .filter((b) => b.face.role === 'Top')
      .map((b) => b.v)
      .sort((a, c) => a - c);
    expect(leftVs[0]).toBeCloseTo(vFront, 6);
    expect(leftVs[1]).toBeCloseTo(vRear, 6);
  });

  it('RIGHT cabinet bore (Bottom face) world-depth via face2DFrame [load-bearing — catches vDir sign flip]', () => {
    // face2DFrame('Bottom'): origin=(-H/2,D/2,0), uDir=(1,0,0), vDir=(0,-1,0).
    // part-local Y of bore at v: D/2 - v.
    // Under SIDE_PANEL_QUAT (part-Y → world -Y): world-Y = -(D/2 - v) = v - D/2.
    // "depth from front" = D + world-Y = D + v - D/2 = D/2 + v  (front is at world-Y=0).
    // Front bore (v=37): depth = D/2 + 37 = 317mm from front (not 37).
    // But the KEY TEST is the sign: vDir=(0,-1,0) gives partY = D/2-v < D/2.
    // If vDir were (0,+1,0) (sign flip), partY = D/2+v → rear bore partY = D/2+533 = 813 > D ← impossible.
    const fRight = face2DFrame({ length: H, width: D, thickness: Tc }, 'Bottom');
    const rightBores = r.cabinetBores.filter((b) => b.face.role === 'Bottom');
    const frontBore = rightBores.find((b) => b.v === vFront)!;
    const rearBore  = rightBores.find((b) => b.v === vRear)!;
    // Part-local Y for front bore: D/2 - 37 = 243
    expect(fRight.origin.y + frontBore.v * fRight.vDir.y).toBeCloseTo(D / 2 - vFront, 6);
    // Part-local Y for rear bore: D/2 - (D-Tc-9) = -(D/2-Tc-9) < 0 — confirms vDir=-Y, not +Y
    expect(fRight.origin.y + rearBore.v * fRight.vDir.y).toBeCloseTo(D / 2 - vRear, 6);
    expect(fRight.origin.y + rearBore.v * fRight.vDir.y).toBeLessThan(0);
  });

  it('cabinet bores have role=tandem-cabinet, connectorKind=tandem, diameter=5, depth=12', () => {
    r.cabinetBores.forEach((b) => {
      expect(b.role).toBe('tandem-cabinet');
      expect(b.connectorKind).toBe('tandem');
      expect(b.diameter).toBe(TANDEM_CABINET_HOLE_DIAMETER);
      expect(b.depth).toBe(TANDEM_HOLE_DEPTH);
    });
  });

  it('boxBottomBores: 4 total (2 per runner × 2 runners), face=Bottom', () => {
    expect(r.boxBottomBores).toHaveLength(4);
    r.boxBottomBores.forEach((b) => {
      expect(b.face.role).toBe('Bottom');
      expect(b.role).toBe('tandem-drawer-bottom');
      expect(b.connectorKind).toBe('tandem');
      expect(b.diameter).toBe(TANDEM_BOTTOM_HOLE_DIAMETER);
    });
  });

  it('boxBottomBores world position matches via face2DFrame Bottom [load-bearing]', () => {
    // Bottom panel dims: length = bw-2T, width = bd-2T, thickness = BOX_BOTTOM_THICKNESS(12)
    const botLen = bw - 2 * T;
    const botWid = bd - 2 * T;
    const BOT = 12; // BOX_BOTTOM_THICKNESS
    const f = face2DFrame({ length: botLen, width: botWid, thickness: BOT }, 'Bottom');

    // For Bottom face: origin=(-botLen/2, botWid/2, 0), uDir=(1,0,0), vDir=(0,-1,0)
    // box-local world of bore at (u,v):
    //   part-local = origin + u*uDir + v*vDir = (-botLen/2+u, botWid/2-v, 0)
    //   bottom panel pose.translation = (bw/2, bd/2, 0) with identity quat
    //   box-local = (bw/2, bd/2, 0) + (-botLen/2+u, botWid/2-v, 0)
    //             = (T + u, bd - T - v, 0)
    // So u=T maps to box-local x=2T, v=TANDEM_REAR_HOOK_FROM_BACK maps to y=bd-T-9
    const rearBores = r.boxBottomBores.filter((b) => b.v === TANDEM_REAR_HOOK_FROM_BACK);
    expect(rearBores).toHaveLength(2);
    for (const b of rearBores) {
      const px = f.origin.x + b.u * f.uDir.x + b.v * f.vDir.x;
      const py = f.origin.y + b.u * f.uDir.y + b.v * f.vDir.y;
      // Bottom panel uses identity (BOTTOM_QUAT): box-local = pose.translation + (px, py, 0)
      // pose.translation = (bw/2, bd/2, 0)
      const boxLocalX = bw / 2 + px;
      const boxLocalY = bd / 2 + py;
      // Rear hole: box-local y should equal bd - T - TANDEM_REAR_HOOK_FROM_BACK
      expect(boxLocalY).toBeCloseTo(bd - T - TANDEM_REAR_HOOK_FROM_BACK, 6);
      // Lateral: left bore at box-local x=2T, right at bw-2T
      // (u_L=T → T+T=2T; u_R=botLen-T → T+(botLen-T)=botLen=bw-2T)
      expect([2 * T, bw - 2 * T]).toContain(Math.round(boxLocalX));
    }
  });

  it('boxBackBores: 2 total (1 per runner), face=Bottom, role=tandem-drawer-back', () => {
    expect(r.boxBackBores).toHaveLength(2);
    r.boxBackBores.forEach((b) => {
      expect(b.face.role).toBe('Bottom');
      expect(b.role).toBe('tandem-drawer-back');
      expect(b.connectorKind).toBe('tandem');
      expect(b.diameter).toBe(TANDEM_LOCK_HOLE_DIAMETER);
    });
  });

  it('boxBackBores world position via face2DFrame Bottom (back panel) [load-bearing]', () => {
    // Back panel dims: length = fbLen = bw-2T, width = bh, thickness = T
    const fbLen = bw - 2 * T;
    const f = face2DFrame({ length: fbLen, width: bh, thickness: T }, 'Bottom');
    // Back panel FRONT_BACK_QUAT: part-X→+X, part-Y→-Z, part-Z→+Y
    // R*(px, py, pz) = (px, pz, -py)
    // Bottom face: origin=(-fbLen/2, bh/2, 0), part-local at (u,v): (-fbLen/2+u, bh/2-v, 0)
    // box-local = pose.translation + R*(part-local)
    //           = (bw/2, bd-T, bh/2) + (-fbLen/2+u, 0, -(bh/2-v))
    //           = (T + u, bd-T, v)
    for (const b of r.boxBackBores) {
      const px = f.origin.x + b.u * f.uDir.x + b.v * f.vDir.x;
      const py = f.origin.y + b.u * f.uDir.y + b.v * f.vDir.y;
      // FRONT_BACK_QUAT: R*(px_part, py_part, 0) = (px_part, 0, -py_part)
      // pose.translation = (bw/2, bd-T, bh/2)
      // box-local.x = bw/2 + px, box-local.z = bh/2 - py
      const boxLocalX = bw / 2 + px;
      const boxLocalZ = bh / 2 - py; // note: minus py (FRONT_BACK_QUAT maps part-Y→-Z)
      // Lateral: 2T (left) or bw-2T (right) — u_L=T,u_R=fbLen-T give box-local x=2T,bw-2T
      expect([2 * T, bw - 2 * T]).toContain(Math.round(boxLocalX));
      // box-local z = v = TANDEM_CABINET_RUNNER_HEIGHT
      expect(boxLocalZ).toBeCloseTo(TANDEM_CABINET_RUNNER_HEIGHT, 6);
    }
  });
});
