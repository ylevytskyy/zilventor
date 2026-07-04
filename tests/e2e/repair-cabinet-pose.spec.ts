/**
 * E2E — BrowserPane sub-assembly context menu: RepairCabinetGeometryCommand.
 *
 * Closes a coverage gap: no existing spec exercises BrowserPane's
 * onContextMenu branch for sub-assembly rows (BrowserPane.tsx:121-150). That
 * branch offers ONE of two mutually-exclusive confirms depending on
 * `hasRepairableLegacyPose(child)`:
 *   - true  (legacy-posed cabinet)  → dialog.repairCabinetPose  → RepairCabinetGeometryCommand
 *   - false (healthy cabinet)       → dialog.openStandalone     → OpenProjectFileCommand
 *
 * Flow A: corrupt a freshly-built cabinet's OPFS bytes to the legacy
 * identity-backfill pose signature (translation===position, quaternion
 * identity — the exact transform `backfillAssembly4b` applies on load,
 * mirrored here from RepairCabinetGeometryCommand.spec.ts's `toLegacyPose`),
 * right-click its BrowserPane row, accept the repair confirm, and verify the
 * real command fixed every component's pose to match the fresh-build ground
 * truth (captured before corruption) — including a concrete check that the
 * Left Side panel's quaternion is repaired from identity to the family-A
 * ry=90° rotation ([0, √2/2, 0, √2/2]). Then verifies undo restores the
 * legacy signature exactly.
 *
 * Flow B: a second, never-corrupted cabinet proves the gate doesn't
 * false-positive — right-clicking it must offer the PRE-EXISTING
 * open-standalone confirm, not the repair one. The dialog is dismissed
 * (never accepted) so the active document never switches away from the
 * assembly mid-test.
 *
 * No screenshots (headless viewport is a black 3D canvas) — every assertion
 * is an OPFS/store probe via page.evaluate + expect.poll, per the project's
 * existing e2e convention (see keyhole-slot-cut.spec.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

const REPAIR_CABINET = 'Repair Pose Cabinet';
const HEALTHY_CABINET = 'Healthy Pose Cabinet';

const REPAIR_DIALOG_TEXT =
  'Repair cabinet geometry? This backfills correct panel placement for a legacy cabinet without changing panel sizes or materials.';

type PoseSnapshot = {
  translation: { x: number; y: number; z: number };
  quaternion: readonly [number, number, number, number];
};
type ComponentSnapshot = {
  id: string;
  partPath: string;
  position: { x: number; y: number; z: number };
  pose: PoseSnapshot | null;
};

type CabinetParams = {
  name: string;
  width: number;
  depth: number;
  height: number;
  toekickHeight: number;
  toekickSetback: number;
  shelfCount: number;
  carcassMaterialId: string;
  backMaterialId: string;
  bandMaterialId: null;
};

function baseCabinetParams(name: string): CabinetParams {
  return {
    name,
    width: 600,
    depth: 560,
    height: 720,
    toekickHeight: 100,
    toekickSetback: 50,
    shelfCount: 1,
    carcassMaterialId: 'm-birch-18',
    backMaterialId: 'm-hb-6',
    bandMaterialId: null,
  };
}

/** Creates a base cabinet via CreateCabinetCommand; returns its `${name}.ziasm` OPFS path. */
async function createBaseCabinet(page: Page, params: CabinetParams): Promise<string> {
  return page.evaluate(async (p: CabinetParams) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
      __zilventorGetOpfs(): Promise<{
        read(path: string): Promise<Uint8Array>;
        write(path: string, b: Uint8Array): Promise<void>;
      }>;
    };
    const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
    const opfs = await w.__zilventorGetOpfs();
    const cmd = new CreateCabinetCommand({ template: 'baseCabinet', params: p, opfs });
    await w.__zilventorStore.getState().bus.execute(cmd);
    return `${p.name}.ziasm`;
  }, params);
}

/** Reads+unpacks a cabinet .ziasm from OPFS, returning a plain-JSON component snapshot. */
async function readCabinetComponents(page: Page, cabinetPath: string): Promise<ComponentSnapshot[]> {
  return page.evaluate(async (p: string) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array> }>;
      __zilventorUnpackAssembly(bytes: Uint8Array): Promise<{
        components: Array<{
          id: string;
          partPath: string;
          position: { x: number; y: number; z: number };
          pose?: { translation: { x: number; y: number; z: number }; quaternion: readonly number[] };
        }>;
      }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    const doc = await w.__zilventorUnpackAssembly(await opfs.read(p));
    return doc.components.map((c) => ({
      id: c.id,
      partPath: c.partPath,
      position: c.position,
      pose: c.pose ? { translation: c.pose.translation, quaternion: c.pose.quaternion as [number, number, number, number] } : null,
    }));
  }, cabinetPath);
}

/**
 * Overwrites `cabinetPath` in OPFS with the legacy identity-backfill pose
 * signature on every component — the exact transform `backfillAssembly4b`
 * (fileFormat.ts:545-569) applies to a pre-pose legacy document on load,
 * duplicated here verbatim from RepairCabinetGeometryCommand.spec.ts's
 * `eulerXYZToQuat`/`toLegacyPose` (that file's independent test oracle).
 */
async function corruptToLegacyPose(page: Page, cabinetPath: string): Promise<void> {
  await page.evaluate(async (p: string) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{
        read(path: string): Promise<Uint8Array>;
        write(path: string, b: Uint8Array): Promise<void>;
      }>;
      __zilventorUnpackAssembly(bytes: Uint8Array): Promise<{
        components: Array<{
          id: string;
          partPath: string;
          position: { x: number; y: number; z: number };
          rotation: { rx: number; ry: number; rz: number };
        }>;
        [k: string]: unknown;
      }>;
      __zilventorPackAssembly(doc: unknown, thumbnail: Uint8Array): Promise<Uint8Array>;
    };

    function eulerXYZToQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
      const cx = Math.cos((rx * Math.PI) / 360); const sx = Math.sin((rx * Math.PI) / 360);
      const cy = Math.cos((ry * Math.PI) / 360); const sy = Math.sin((ry * Math.PI) / 360);
      const cz = Math.cos((rz * Math.PI) / 360); const sz = Math.sin((rz * Math.PI) / 360);
      const x = sx * cy * cz + cx * sy * sz;
      const y = cx * sy * cz - sx * cy * sz;
      const z = cx * cy * sz + sx * sy * cz;
      const w_ = cx * cy * cz - sx * sy * sz;
      return [x, y, z, w_];
    }

    const opfs = await w.__zilventorGetOpfs();
    const doc = await w.__zilventorUnpackAssembly(await opfs.read(p));
    const legacyDoc = {
      ...doc,
      components: doc.components.map((c) => ({
        ...c,
        pose: {
          translation: { ...c.position },
          quaternion: eulerXYZToQuat(c.rotation.rx, c.rotation.ry, c.rotation.rz),
        },
      })),
    };
    const bytes = await w.__zilventorPackAssembly(legacyDoc, new Uint8Array());
    await opfs.write(p, bytes);
  }, cabinetPath);
}

/** True when every `fresh` component's pose is matched (within tolerance) in `actual`. */
function posesMatch(actual: ComponentSnapshot[], fresh: ComponentSnapshot[], epsMm = 1e-2): boolean {
  for (const f of fresh) {
    const a = actual.find((c) => c.id === f.id);
    if (!a || !a.pose || !f.pose) return false;
    const dt = Math.max(
      Math.abs(a.pose.translation.x - f.pose.translation.x),
      Math.abs(a.pose.translation.y - f.pose.translation.y),
      Math.abs(a.pose.translation.z - f.pose.translation.z),
    );
    const dq = Math.max(
      Math.abs(a.pose.quaternion[0] - f.pose.quaternion[0]),
      Math.abs(a.pose.quaternion[1] - f.pose.quaternion[1]),
      Math.abs(a.pose.quaternion[2] - f.pose.quaternion[2]),
      Math.abs(a.pose.quaternion[3] - f.pose.quaternion[3]),
    );
    if (dt > epsMm || dq > 1e-3) return false;
  }
  return true;
}

/** True when every component's pose still carries the legacy signature (translation===position, identity quaternion). */
function allLegacy(actual: ComponentSnapshot[], epsMm = 1e-6): boolean {
  return actual.every((c) => {
    if (!c.pose) return true;
    const t = c.pose.translation;
    const p = c.position;
    const translationUncorrected =
      Math.abs(t.x - p.x) < epsMm && Math.abs(t.y - p.y) < epsMm && Math.abs(t.z - p.z) < epsMm;
    if (!translationUncorrected) return false;
    const q = c.pose.quaternion;
    return Math.abs(q[0]) < 1e-3 && Math.abs(q[1]) < 1e-3 && Math.abs(q[2]) < 1e-3 && Math.abs(q[3] - 1) < 1e-3;
  });
}

test(
  'repair-cabinet-pose: BrowserPane context menu offers repair for a legacy cabinet, open-standalone for a healthy one',
  async ({ page }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── New assembly + materials ────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });
    await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { addMaterial(m: unknown): void } } };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── Create two base cabinets: one to corrupt+repair, one to leave healthy ──
    const repairCabinetPath = await createBaseCabinet(page, baseCabinetParams(REPAIR_CABINET));
    await page.waitForFunction(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
      return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
    });
    const healthyCabinetPath = await createBaseCabinet(page, baseCabinetParams(HEALTHY_CABINET));
    await page.waitForFunction(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
      return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 2;
    });

    // Wait for BrowserPane's production sub-assembly loader (App.tsx) to populate
    // subAssemblyDocs for both cabinets — required for hasRepairableLegacyPose
    // to see real data on right-click instead of `child === undefined`.
    await page.waitForFunction(
      ([r, h]) => {
        const w = window as unknown as { __zilventorStore: { getState(): { subAssemblyDocs: Record<string, unknown> } } };
        const docs = w.__zilventorStore.getState().subAssemblyDocs;
        return !!docs[r as string] && !!docs[h as string];
      },
      [repairCabinetPath, healthyCabinetPath],
    );

    // ── Ground truth: fresh (correct) poses, captured BEFORE corruption ─────
    const freshComponents = await readCabinetComponents(page, repairCabinetPath);
    const freshLeftSide = freshComponents.find((c) => c.partPath.endsWith('Left Side.zipt'));
    expect(freshLeftSide?.pose, 'fresh-built Left Side must already carry a correct pose').toBeTruthy();

    // ── Corrupt the repair cabinet to the legacy identity-backfill signature ─
    await corruptToLegacyPose(page, repairCabinetPath);
    await page.evaluate(async (p: string) => {
      const w = window as unknown as { __zilventorSubAsmInvalidate(path: string): Promise<void> };
      await w.__zilventorSubAsmInvalidate(p);
    }, repairCabinetPath);

    // Wait for the store mirror to reflect the corrupted (legacy-signature) doc.
    await page.waitForFunction((p: string) => {
      const w = window as unknown as { __zilventorStore: { getState(): { subAssemblyDocs: Record<string, { components: Array<{ partPath: string; position: { x: number; y: number; z: number }; pose?: { translation: { x: number; y: number; z: number }; quaternion: number[] } }> }> } } };
      const doc = w.__zilventorStore.getState().subAssemblyDocs[p];
      const c = doc?.components.find((x) => x.partPath.endsWith('Left Side.zipt'));
      if (!c?.pose) return false;
      const t = c.pose.translation; const pos = c.position; const q = c.pose.quaternion;
      const translationUncorrected = Math.abs(t.x - pos.x) < 1e-6 && Math.abs(t.y - pos.y) < 1e-6 && Math.abs(t.z - pos.z) < 1e-6;
      const identityQuat = Math.abs(q[0]) < 1e-3 && Math.abs(q[1]) < 1e-3 && Math.abs(q[2]) < 1e-3 && Math.abs(q[3] - 1) < 1e-3;
      return translationUncorrected && identityQuat;
    }, repairCabinetPath);

    // ── Flow A: right-click the legacy cabinet → repair confirm → accept ────
    let repairDialogMessage = '';
    page.once('dialog', async (d) => {
      repairDialogMessage = d.message();
      await d.accept();
    });
    await page
      .locator('[data-testid="browser-pane"]')
      .getByText(REPAIR_CABINET)
      .first()
      .click({ button: 'right' });

    await expect
      .poll(() => repairDialogMessage, { message: 'repair confirm dialog must have fired' })
      .not.toBe('');
    expect(repairDialogMessage, 'legacy cabinet must offer the repair confirm, not open-standalone').toBe(
      REPAIR_DIALOG_TEXT,
    );

    // ── Poll: OPFS-persisted repair matches the fresh-build ground truth ────
    await expect
      .poll(
        async () => {
          const repaired = await readCabinetComponents(page, repairCabinetPath);
          return posesMatch(repaired, freshComponents);
        },
        { timeout: 30_000, message: 'RepairCabinetGeometryCommand must restore every component pose to the fresh-build ground truth' },
      )
      .toBe(true);

    const repairedComponents = await readCabinetComponents(page, repairCabinetPath);
    const repairedLeftSide = repairedComponents.find((c) => c.partPath.endsWith('Left Side.zipt'));
    expect(repairedLeftSide?.pose, 'repaired Left Side must carry a pose').toBeTruthy();
    // Concrete check: Left Side's family-A rotation is ry=90° regardless of cabinet
    // dims — quaternion [0, sin(45°), 0, cos(45°)].
    const half = Math.SQRT1_2;
    expect(repairedLeftSide!.pose!.quaternion[0]).toBeCloseTo(0, 3);
    expect(repairedLeftSide!.pose!.quaternion[1]).toBeCloseTo(half, 3);
    expect(repairedLeftSide!.pose!.quaternion[2]).toBeCloseTo(0, 3);
    expect(repairedLeftSide!.pose!.quaternion[3]).toBeCloseTo(half, 3);
    // Translation must have actually moved off the raw (legacy) position —
    // proves the repair, not a no-op, wrote this value.
    expect(
      Math.abs(repairedLeftSide!.pose!.translation.y - repairedLeftSide!.position.y) > 1,
      'repaired translation must differ from the raw legacy position (half-extent offset applied)',
    ).toBe(true);
    // position/rotation (the numbers CreateCabinetCommand originally wrote) must
    // never be touched by the repair — purely additive per the command's contract.
    expect(repairedLeftSide!.position).toEqual(freshLeftSide!.position);

    // ── Undo restores the legacy (corrupted) signature exactly ─────────────
    await page.evaluate(async () => {
      const w = window as unknown as { __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } } };
      const ok = await w.__zilventorStore.getState().bus.undo();
      if (!ok) throw new Error('bus.undo() returned false — nothing to undo');
    });
    await expect
      .poll(
        async () => {
          const reverted = await readCabinetComponents(page, repairCabinetPath);
          return allLegacy(reverted);
        },
        { timeout: 30_000, message: 'undo must restore every component pose to the legacy identity-backfill signature' },
      )
      .toBe(true);

    // ── Flow B: right-click the healthy (never-corrupted) cabinet ──────────
    // hasRepairableLegacyPose must be false → falls through to the
    // PRE-EXISTING open-standalone confirm. DISMISS it (never accept) so the
    // active document stays on this assembly.
    let openStandaloneMessage = '';
    page.once('dialog', async (d) => {
      openStandaloneMessage = d.message();
      await d.dismiss();
    });
    await page
      .locator('[data-testid="browser-pane"]')
      .getByText(HEALTHY_CABINET)
      .first()
      .click({ button: 'right' });

    await expect
      .poll(() => openStandaloneMessage, { message: 'open-standalone confirm dialog must have fired' })
      .not.toBe('');
    expect(
      openStandaloneMessage,
      'healthy cabinet must offer open-standalone, NOT the repair confirm — the repair branch must not false-positive',
    ).toBe(`Open ${HEALTHY_CABINET} in standalone?`);

    // Dismissing must have been a true no-op: still on the same assembly document.
    const docKindAfterDismiss = await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
      return w.__zilventorStore.getState().activeDocument?.kind;
    });
    expect(docKindAfterDismiss, 'dismissing open-standalone must not switch the active document').toBe('assembly');

    // ── No browser errors ────────────────────────────────────────────────────
    const realErrors = consoleErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'));
    expect(realErrors, 'no browser errors during repair-cabinet-pose e2e flow').toHaveLength(0);
  },
);
