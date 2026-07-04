import type { BoreOp, BoreRole } from './bore';
import {
  TANDEM_CABINET_FRONT_SETBACK,
  TANDEM_CABINET_REAR_HOLE_FROM_BACK,
  TANDEM_CABINET_RUNNER_HEIGHT,
  TANDEM_CABINET_HOLE_DIAMETER,
  TANDEM_LOCK_HOLE_DIAMETER,
  TANDEM_BOTTOM_HOLE_DIAMETER,
  TANDEM_HOLE_DEPTH,
  TANDEM_REAR_HOOK_FROM_BACK,
} from './tandemConventions';
import { BOX_PANEL_THICKNESS as T } from './drawerConventions';
import {
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from './prisadkaFaceConventions';
import type { DrawerSlideCtx } from './drawerSlideMath';

/**
 * Emits BoreOps for one drawer's Blum TANDEM under-mount slide:
 *   cabinetBores:    Ø5 on cabinet L/R inner side faces (role 'tandem-cabinet')
 *   boxBottomBores:  Ø5 on drawer-box bottom-panel 'Bottom' face (role 'tandem-drawer-bottom')
 *   boxBackBores:    Ø10 on drawer-box back-panel 'Bottom' face (role 'tandem-drawer-back')
 *
 * Requires box.bw (box outer width) for bottom bore lateral positions.
 *
 * Cabinet bore u-alignment (world-Z):
 *   runnerWorldZ = openBottomZ + drawerIndex * slotH + TANDEM_CABINET_RUNNER_HEIGHT
 *
 * Bottom panel bore (face='Bottom', BOTTOM_QUAT=identity):
 *   box-local point at (u,v) = (T + u, bd - T - v, 0)
 *   Left runner:  u = T,         v_rear = TANDEM_REAR_HOOK_FROM_BACK, v_front = botWid − TANDEM_CABINET_FRONT_SETBACK
 *   Right runner: u = botLen − T, same v
 *
 * Back panel bore (face='Bottom', FRONT_BACK_QUAT: part-X→+X, part-Z→+Y):
 *   box-local point at (u,v) = (T + u, bd − T, v)  [v = box-local Z]
 *   Left runner:  u = T,       v = TANDEM_CABINET_RUNNER_HEIGHT
 *   Right runner: u = fbLen − T, same v
 */
export function tandemSlideMath(
  ctx: DrawerSlideCtx & { box: { bw: number } },
): {
  cabinetBores: BoreOp[];
  boxBottomBores: BoreOp[];
  boxBackBores: BoreOp[];
} {
  const { drawerIndex: i, openBottomZ, slotH, cabinet, box, slideSkuId } = ctx;
  const { D, Tc } = cabinet;
  const { bd, bw } = box;

  const botLen = bw - 2 * T;
  const botWid = bd - 2 * T;
  const fbLen  = bw - 2 * T; // same as botLen (front/back panel inner width)

  // Runner world-Z — the independent oracle used by all three bore groups
  const runnerWorldZ = openBottomZ + i * slotH + TANDEM_CABINET_RUNNER_HEIGHT;

  const sides = [
    { side: 'L' as const, cabinetFace: LEFT_SIDE_INNER_FACE,  uBot: T,          uBack: T },
    { side: 'R' as const, cabinetFace: RIGHT_SIDE_INNER_FACE, uBot: botLen - T, uBack: fbLen - T },
  ];

  const cabinetBores: BoreOp[] = [];
  const boxBottomBores: BoreOp[] = [];
  const boxBackBores: BoreOp[] = [];

  for (const { side, cabinetFace, uBot, uBack } of sides) {
    const connectorId = `tandem-${i}-${side}`;

    // ── Cabinet side bores (2 per side: front + rear) ────────────────────────
    const cabinetVs: [number, string][] = [
      [TANDEM_CABINET_FRONT_SETBACK, 'front'],
      [D - Tc - TANDEM_CABINET_REAR_HOLE_FROM_BACK, 'rear'],
    ];
    cabinetVs.forEach(([v, tag]) => {
      cabinetBores.push({
        id: `tandem-${i}-${side}-cab-${tag}`,
        face: { featureId: 'panel', role: cabinetFace, instance: 0 },
        u: runnerWorldZ,
        v,
        diameter: TANDEM_CABINET_HOLE_DIAMETER,
        depth: TANDEM_HOLE_DEPTH,
        role: 'tandem-cabinet' as BoreRole,
        connectorId,
        connectorKind: 'tandem',
        ...(slideSkuId ? { sku: slideSkuId } : {}),
      });
    });

    // ── Box bottom bores (2 per runner: rear-hook + front-fix) ───────────────
    const bottomVs: [number, string][] = [
      [TANDEM_REAR_HOOK_FROM_BACK, 'rear'],
      [botWid - TANDEM_CABINET_FRONT_SETBACK, 'front'],
    ];
    bottomVs.forEach(([v, tag]) => {
      boxBottomBores.push({
        id: `tandem-${i}-${side}-bot-${tag}`,
        face: { featureId: 'panel', role: 'Bottom', instance: 0 },
        u: uBot,
        v,
        diameter: TANDEM_BOTTOM_HOLE_DIAMETER,
        depth: TANDEM_HOLE_DEPTH,
        role: 'tandem-drawer-bottom' as BoreRole,
        connectorId,
        connectorKind: 'tandem',
        ...(slideSkuId ? { sku: slideSkuId } : {}),
      });
    });

    // ── Box back bore (1 per runner: locking-device hole) ────────────────────
    boxBackBores.push({
      id: `tandem-${i}-${side}-back`,
      face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: uBack,
      v: TANDEM_CABINET_RUNNER_HEIGHT,
      diameter: TANDEM_LOCK_HOLE_DIAMETER,
      depth: TANDEM_HOLE_DEPTH,
      role: 'tandem-drawer-back' as BoreRole,
      connectorId,
      connectorKind: 'tandem',
      ...(slideSkuId ? { sku: slideSkuId } : {}),
    });
  }

  return { cabinetBores, boxBottomBores, boxBackBores };
}
