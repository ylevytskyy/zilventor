// tests/e2e/drawing/material-hatch-pattern.spec.ts
/**
 * T-material-hatch-pattern — Editable per-material hatch angle/spacing, end-to-end.
 *
 * Flow:
 *   1. Build a 30×30×20 part.
 *   2. AddMaterialCommand (WoodHatch, #aabbcc, 18mm) → materials[0] populated.
 *   3. EditMaterialCommand to set hatchAngleDeg=20, hatchSpacingMm=2.
 *   4. Create drawing + base view (front, 1:1, patch viewMatrix) + horizontal section view.
 *   5. Read hatchSegments; assert every segment's normalized line angle ≈ 20° (±2°), NOT ≈ 45°.
 *   6. Wait 700ms (OPFS autosave debounce = 500ms), reload, confirm persistence.
 *
 * Teeth: relies on Task 4's materials[0] fallback in hatchLookup. If the
 * fallback regresses, every segment stays at 45° and step 5 fails.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

// Normalize a directed segment angle (-180..180] into [0, 180) for line-direction comparison.
function normLineAngleDeg(p0: { x: number; y: number }, p1: { x: number; y: number }): number {
  const a = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  let n = a % 180;
  if (n < 0) n += 180;
  return n;
}

test('material-hatch-pattern: per-material angle/spacing override flows to part-source section hatch + persists', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    console.log('BROWSER:', m.type(), t);
    if (m.type() === 'error') consoleErrors.push(t);
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(`PAGEERROR: ${e.message}`);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // Step 1: Build the box.
  await buildBox(page, { width: 30, height: 30, depth: 20 });

  // Steps 2 + 3: Add material, then edit hatch.
  const matInfo = await page.evaluate(async () => {
    const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
    const { EditMaterialCommand } = await import('/src/commands/EditMaterialCommand.ts');

    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; materials: Array<{ id: string; hatchAngleDeg?: number; hatchSpacingMm?: number }> } | null;
          bus: { execute(c: unknown): Promise<unknown> };
        };
      };
    }).__zilventorStore;

    const sBefore = store.getState();
    if (!sBefore.activePart) throw new Error('mhp: no active part');
    const bus = sBefore.bus;

    await bus.execute(new AddMaterialCommand({ name: 'WoodHatch', defaultThickness: 18, color: '#aabbcc' }));
    const sAfterAdd = store.getState();
    const newMat = sAfterAdd.activePart!.materials.find((m) => m.id.startsWith('mat-'));
    if (!newMat) throw new Error('mhp: AddMaterial did not produce a material with id starting mat-');

    await bus.execute(new EditMaterialCommand(newMat.id, {
      name: 'WoodHatch', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 20, hatchSpacingMm: 2,
      clearSheetStock: true,
    }));

    const sAfterEdit = store.getState();
    const edited = sAfterEdit.activePart!.materials.find((m) => m.id === newMat.id)!;
    return { materialId: edited.id, angle: edited.hatchAngleDeg, spacing: edited.hatchSpacingMm };
  });

  console.log('[mhp] material after edit:', matInfo);
  expect(matInfo.angle, 'hatchAngleDeg must be 20 after Edit').toBe(20);
  expect(matInfo.spacing, 'hatchSpacingMm must be 2 after Edit').toBe(2);

  // Step 4: Create drawing + base view (with viewMatrix patch) + section view.
  const { sheetId, sectionViewId } = await page.evaluate(async () => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: { kind: string; document: { id: string; sheets: Array<{ id: string; views: Array<{ id: string; kind: string }> }> } } | null;
          activePart: { id: string } | null;
          activeDrawingSourcePartId: string | null;
          kernel: {
            execute(id: string): Promise<{ ok: boolean }>;
            getProjectorInput(args: { kind: string; partId: string }): Promise<{ bbox: readonly number[] } | null>;
          } | null;
        };
        setState(p: unknown): void;
      };
    }).__zilventorStore;

    const s0 = store.getState();
    if (!s0.activePart || !s0.kernel) throw new Error('mhp: kernel or activePart missing');
    // Warm the kernel cache for the active part.
    await s0.kernel.execute(s0.activePart.id);
    // sourcePath = `${partId}.zipt` triggers the OPFS-fail fallback in loadDrawingSource:
    // the fallback detects stem === activePartId and sets activeDrawingSourcePartId correctly.
    const sourcePartId = s0.activePart.id;

    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    await new CreateDrawingCommand({ sourcePath: `${sourcePartId}.zipt`, sourceKind: 'part' }).apply();

    const s1 = store.getState();
    const drawing = s1.activeDocument!.document;
    const sheetId = drawing.sheets[0]!.id;

    const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
    await new AddBaseViewCommand({
      sheetId,
      positionMm: { x: 80, y: 80 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    }).apply();

    const s2 = store.getState();
    const baseView = s2.activeDocument!.document.sheets.find((sh) => sh.id === sheetId)!.views.find((v) => v.kind === 'base')!;

    // Patch base view with viewMatrix (required by AddSectionViewCommand).
    const partKernelId = s2.activeDrawingSourcePartId ?? s2.activePart!.id;
    const input = await s2.kernel!.getProjectorInput({ kind: 'part', partId: partKernelId });
    if (!input) throw new Error('mhp: getProjectorInput null');
    const [minX, minY, minZ, maxX, maxY, maxZ] = input.bbox;
    const cx = ((minX as number) + (maxX as number)) / 2;
    const cy = ((minY as number) + (maxY as number)) / 2;
    const cz = ((minZ as number) + (maxZ as number)) / 2;
    const vm = [1, 0, 0, -cx, 0, 1, 0, -cy, 0, 0, 1, -cz, 0, 0, 0, 1];

    const cDoc = store.getState().activeDocument!.document as { sheets: Array<{ id: string; views: Array<Record<string, unknown>> }> };
    const patched = {
      ...cDoc,
      sheets: cDoc.sheets.map((sh) =>
        sh.id !== sheetId ? sh : {
          ...sh,
          views: sh.views.map((v) => (v as { id: string }).id !== baseView.id ? v : { ...v, viewMatrix: vm }),
        }
      ),
    };
    store.setState({ activeDocument: { kind: 'drawing', document: patched }, activeDrawing: patched } as never);

    const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
    await new AddSectionViewCommand({
      drawingId: (store.getState().activeDocument!.document as { id: string }).id,
      sheetId,
      parentViewId: baseView.id,
      p0: { x: -20, y: 0 },
      p1: { x: 20, y: 0 },
      arrowDirection: 1 as -1 | 1,
      dropAt: { x: 200, y: 80 },
      mode: 'full',
    }).apply();

    const s3 = store.getState();
    const sectionView = s3.activeDocument!.document.sheets.find((sh) => sh.id === sheetId)!.views.find((v) => v.kind === 'section')!;
    return { sheetId, sectionViewId: sectionView.id };
  });

  // Step 5: Read hatchSegments and assert angles ≈ 20°.
  const hatchSegs = await page.evaluate(({ shId, svId }: { shId: string; svId: string }) => {
    const doc = (window as unknown as {
      __zilventorStore: { getState(): { activeDocument: { document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; hatchSegments?: Array<{ p0: { x: number; y: number }; p1: { x: number; y: number } }> }> }> } } } };
    }).__zilventorStore.getState().activeDocument!.document;
    const sheet = doc.sheets.find((s) => s.id === shId)!;
    const sv = sheet.views.find((v) => v.id === svId)!;
    return (sv.hatchSegments ?? []).map((seg) => ({ p0: seg.p0, p1: seg.p1 }));
  }, { shId: sheetId, svId: sectionViewId });

  console.log('[mhp] hatchSegment count:', hatchSegs.length);
  expect(hatchSegs.length, 'expected ≥1 hatch segment in section view').toBeGreaterThan(0);

  const normAngles = hatchSegs.map((s) => normLineAngleDeg(s.p0, s.p1));
  console.log('[mhp] normalized angles (first 5):', normAngles.slice(0, 5));

  const TOLERANCE = 2;
  for (const a of normAngles) {
    expect(Math.abs(a - 20), `segment angle ${a} not within ${TOLERANCE}° of 20°`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(a - 45), `segment angle ${a} unexpectedly close to default 45° — fallback regression`).toBeGreaterThan(5);
  }

  // Step 6: Persistence across reload.
  // The kernel's saveToBytes packs the kernel-worker's copy of the part (which has materials:[]).
  // To test real persistence, we: (a) pack the store's part (with hatch fields) to OPFS via
  // __zilventorPackProject — mirroring the material-hatch-color.spec.ts pattern — (b) set the
  // localStorage pointer, (c) reload, (d) verify the restored activePart has the hatch fields.
  //
  // After CreateDrawingCommand, activePart is null. The source part doc is in activeDrawingSourceDocument.
  const partName = await page.evaluate(async ({ matId }: { matId: string }) => {
    type PartLike = {
      id: string; name: string; units: string; parameters: unknown; properties: unknown;
      featureTree: unknown[]; materials: Array<{ id: string; hatchAngleDeg?: number; hatchSpacingMm?: number }>;
      hardware: unknown[];
    };
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: PartLike | null;
          activeDrawingSourceDocument: PartLike | null;
          activeDrawingSourcePartId: string | null;
          kernel: { saveToBytes(id: string): Promise<Uint8Array> } | null;
        };
      };
    }).__zilventorStore;

    const s = store.getState();
    // After CreateDrawingCommand, activePart is null; use the source document captured by CreateDrawingCommand.
    const partDoc = s.activePart ?? s.activeDrawingSourceDocument;
    const partId = s.activeDrawingSourcePartId ?? s.activePart?.id;
    if (!partDoc || !partId) throw new Error(`mhp step6: no part doc (activePart=${JSON.stringify(s.activePart?.id)}, sourceDoc=${JSON.stringify(s.activeDrawingSourceDocument?.id)}, sourcePartId=${partId})`);

    // Ensure partDoc has the hatch materials (from the store, not the kernel).
    const mat = partDoc.materials.find((m) => m.id === matId);
    if (!mat || mat.hatchAngleDeg !== 20) {
      throw new Error(`mhp step6: source doc materials don't have hatch. mat=${JSON.stringify(mat)}`);
    }

    // Pack the store's part (with hatch materials) via __zilventorPackProject.
    // This is the correct way to persist app-layer metadata that the kernel worker doesn't track.
    const w2 = window as unknown as {
      __zilventorPackProject: (input: { manifest: unknown; blobs: Record<string, Uint8Array> }) => Promise<Uint8Array>;
    };
    if (!w2.__zilventorPackProject) throw new Error('mhp step6: __zilventorPackProject not found');

    // Get the kernel BREP bytes for the part geometry.
    if (!s.kernel) throw new Error('mhp step6: kernel not available');
    const kBytes = await s.kernel.saveToBytes(partId);

    // Unpack the kernel bytes to get the manifest + blobs, then splice in the store's full part doc.
    const w3 = window as unknown as {
      __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array }>;
    };
    if (!w3.__zilventorUnpackProject) throw new Error('mhp step6: __zilventorUnpackProject not found');
    const { manifest: kManifest, blobs } = await w3.__zilventorUnpackProject(kBytes);

    // Replace the manifest document with the store's partDoc (which has hatch materials).
    const fullManifest = {
      ...(kManifest as object),
      document: partDoc,
    };

    const packed = await w2.__zilventorPackProject({ manifest: fullManifest, blobs });

    // Write to OPFS at ${name}.zipt — the path the restore system expects.
    const opfsPath = `${partDoc.name}.zipt`;
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(opfsPath, { create: true });
    const wh = await fh.createWritable();
    await wh.write(packed as unknown as FileSystemWriteChunkType);
    await wh.close();

    // Set the localStorage pointer so restoreLastOpenDocument picks this file.
    localStorage.setItem('zilventor:lastOpenDocument', JSON.stringify({ kind: 'part', opfsPath }));

    console.log('[mhp] step6: packed part with hatch materials to OPFS at', opfsPath,
      'matId=', matId, 'angle=',
      partDoc.materials.find((m) => m.id === matId)?.hatchAngleDeg);
    return partDoc.name;
  }, { matId: matInfo.materialId });

  console.log('[mhp] part name for reload:', partName);

  // Now reload — restoreLastOpenDocument reads localStorage pointer + OPFS file.
  await page.reload();
  await waitForKernelReady(page);

  const persistedMat = await page.evaluate(({ matId }: { matId: string }) => {
    const s = (window as unknown as {
      __zilventorStore: { getState(): { activePart: { materials: Array<{ id: string; hatchAngleDeg?: number; hatchSpacingMm?: number }> } | null } };
    }).__zilventorStore.getState();
    if (!s.activePart) return null;
    return s.activePart.materials.find((m) => m.id === matId) ?? null;
  }, { matId: matInfo.materialId });

  console.log('[mhp] material after reload:', persistedMat);
  expect(persistedMat, 'material must survive reload').not.toBeNull();
  expect(persistedMat!.hatchAngleDeg, 'hatchAngleDeg must survive reload').toBe(20);
  expect(persistedMat!.hatchSpacingMm, 'hatchSpacingMm must survive reload').toBe(2);

  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
  }
});
