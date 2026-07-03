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
 *   6. Wait for autosave (natural path) + localStorage pointer override → reload
 *      — confirm hatch fields round-trip. EditMaterialCommand now calls
 *      syncPartMaterials() which mirrors store materials into the kernel's parts
 *      map before saveToBytes runs. waitForAutosave fires BEFORE CreateDrawingCommand
 *      to prevent the drawing-creation debounce from racing the part autosave.
 *
 * Teeth: relies on Task 4's materials[0] fallback + Task 5's
 * activeDrawingSourceDocument fallback in hatchLookup. If either regresses,
 * every segment stays at 45° and step 5 fails (teeth-verified).
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';
import { waitForAutosave } from '../helpers/waitForAutosave';

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

  // Wait for the natural part autosave to fire with the edited materials.
  // (kernel-sync ensures kernel.saveToBytes packs the hatch fields.)
  // Must happen BEFORE CreateDrawingCommand resets the debounce timer.
  await waitForAutosave(page);

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
  // After CreateDrawingCommand, activeDocument (and lastOpenDocument) is the drawing.
  // Switch back to the part via the REAL product path — the same `setActivePart`
  // store setter FileTab's "Open" flow uses to reactivate a part document — instead
  // of hand-writing localStorage. `activeDrawingSourceDocument` is the exact part
  // object CreateDrawingCommand captured as `activePartDoc` before switching to the
  // drawing, so it already carries the Step 3 hatch-material edit.
  //
  // Calling setActivePart changes activeDocument identity, which retriggers
  // App.tsx's OPFS-autosave debounce (500ms, keyed off activeDocument). When that
  // timer fires it re-reads the CURRENT activeDocument (now the part), re-packs it
  // via kernel.saveToBytes(partId, ...) — using the kernel's internal materials map,
  // already synced by EditMaterialCommand's syncPartMaterials() in Step 3 and
  // untouched since — writes it to OPFS, and calls setLastOpenDocument({kind:'part',...})
  // itself. Because nothing mutates activeDocument after this call, that write is the
  // LAST one and the pointer converges to the part durably (no manual override to race
  // against / get clobbered by a stale in-flight drawing-autosave callback).
  const partName = await page.evaluate(() => {
    const s = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDrawingSourceDocument: { name: string; id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    }).__zilventorStore;
    const state = s.getState();
    const partDoc = state.activeDrawingSourceDocument;
    if (!partDoc) throw new Error('mhp step6: no activeDrawingSourceDocument');
    state.setActivePart(partDoc);
    return partDoc.name;
  });

  console.log('[mhp] part name for reload:', partName);

  // Poll the full post-condition — pointer kind==='part' AND opfsPath references the
  // part AND the OPFS file exists — before reloading. Mirrors the T-6-20 fix
  // (commit 057fd992): poll re-runs the whole condition to a generous deadline
  // instead of a one-shot "pointer exists" check, so a stale intermediate pointer
  // write (e.g. a still-in-flight drawing-autosave callback landing after
  // setActivePart but before the freshly-scheduled part-autosave fires) doesn't get
  // misread as done. The material content itself isn't re-verified from the OPFS
  // bytes here: kernel.saveToBytes always packs the kernel's current materials map
  // for this part id, which was synced once in Step 3 and never mutated since, so
  // every part-autosave write (regardless of which one lands last) carries the
  // edited hatch fields — the real content assertion happens post-reload below.
  let pointerVerified: { ok: boolean; reason: string } = { ok: false, reason: 'not polled yet' };
  await expect
    .poll(
      async () => {
        pointerVerified = await page.evaluate(
          async ({ expectedPartName }: { expectedPartName: string }) => {
            const raw = localStorage.getItem('zilventor:lastOpenDocument');
            if (!raw) return { ok: false, reason: 'localStorage pointer not set' };
            let pointer: unknown;
            try { pointer = JSON.parse(raw); } catch { return { ok: false, reason: 'localStorage pointer not valid JSON' }; }
            const p = pointer as Record<string, unknown>;
            if (p['kind'] !== 'part') return { ok: false, reason: `pointer kind is ${p['kind']}` };
            const opfsPath = p['opfsPath'] as string;
            if (!opfsPath.includes(expectedPartName)) {
              return { ok: false, reason: `opfsPath ${opfsPath} does not reference part ${expectedPartName}` };
            }

            // Check OPFS file exists.
            try {
              const root = await navigator.storage.getDirectory();
              const parts = opfsPath.split('/').filter((x: string) => x.length > 0);
              let dir: FileSystemDirectoryHandle = root;
              for (let i = 0; i < parts.length - 1; i++) {
                dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
              }
              await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
            } catch {
              return { ok: false, reason: `OPFS file ${opfsPath} not found` };
            }

            return { ok: true, reason: '' };
          },
          { expectedPartName: partName },
        );
        return pointerVerified.ok;
      },
      {
        timeout: 20_000,
        message: 'Pointer must converge to the part (kind==="part", matching opfsPath, OPFS file present) after switching back via setActivePart',
      },
    )
    .toBe(true);

  expect(pointerVerified.ok, `Pointer not verified: ${pointerVerified.reason}`).toBe(true);

  // Now reload — restoreLastOpenDocument reads localStorage pointer + OPFS file.
  await page.reload();
  await waitForKernelReady(page);

  // waitForKernelReady only confirms the kernel is initialized (status bar text
  // 'Ready') — it does NOT confirm the boot-restore effect has finished. Both
  // are triggered by the same `kernelReady` flag but run as independent effects
  // (see App.tsx ~L1319 boot-restore vs ~L5574 status text), so 'Ready' can
  // render before `restoreLastOpenDocument()` resolves and calls
  // setActiveDocument. Direct observation (repro across 40 runs, --workers=4
  // --repeat-each=20): failing runs show activeDocument===null / activePart===
  // null right after waitForKernelReady, even though the OPFS pointer + bytes
  // are already correct at that point — a pure test-side read-too-early race,
  // not a persistence bug. Mirrors T-6-20's step 6 waitForFunction gate.
  await page.waitForFunction(
    () => {
      const store = (window as unknown as {
        __zilventorStore?: { getState(): { activeDocument: { kind: string } | null } };
      }).__zilventorStore;
      return store?.getState()?.activeDocument?.kind === 'part';
    },
    undefined,
    { timeout: 30_000 },
  );

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
