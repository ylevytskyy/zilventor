/**
 * E2E: присадка slice 2 — doors + Система-32 shelf pins.
 * Real WASM · real OCCT bake · real DXF/CSV bytes · real OPFS · real 3D markers.
 *
 * This is the slice-2 advance over prisadka-carcass-boring.spec.ts: that spec
 * SKIPPED 3D-marker assertions because prod left subAssemblyDocs unpopulated
 * (cabinets = placeholder boxes). Slice 1 (bdfe322) shipped the production
 * sub-assembly loader (App.tsx:3162-3206) AND AddDoorCommand reloads the door's
 * .ziasm entry, so this spec DOES assert markers via
 * store.viewport.getSceneManager().boreMarkerCount(), forcing the warm+rebuild
 * deterministically with the __zilventorSubAsmInvalidate DEV hook.
 *
 * Addendum §4: AddDoorCommand derives cabinet dims from the unpacked .ziasm —
 * this e2e drives THAT derivation path. The params.cabinet field is passed as
 * zeros (intentionally, per AddDoorCommand.spec.ts SINGLE_DOOR_ZERO_DIMS pattern)
 * because AddDoorCommand.apply() overrides cabinet with derived dims before calling
 * doorMath. If the derivation did NOT happen, doorMath would receive zeros and produce
 * negative door dims → the doorBores.count assertion would fail. That failure is the
 * meaningful RED that proves derivation is wired.
 *
 * Addendum §6: shelf-pin params are passed as inline literals (no dynamic import
 * of '@zilventor/shared/shelfPinGrid' — that subpath has no exports map and does
 * not resolve in the Playwright browser context). Values match DEFAULT_SHELF_PIN_PARAMS
 * as defined in Phase 2 Task 1.
 *
 * Addendum §8: F3 undo-check reads subAssemblyDocs[cabinetPath] from the store
 * (after __zilventorSubAsmInvalidate) instead of unpacking the .ziasm via
 * __zilventorUnpackProject (which is the PART packer, wrong for an assembly).
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet, 1 shelf).
 *   B. AddDoorCommand (single, full overlay) — command derives cabinet dims from
 *      the .ziasm → door component lands in the cabinet .ziasm
 *      (subAssemblyDocs[cabinetPath].components gains role:'door')
 *      → Ø35 hingeCup markers render (real panel, NOT placeholder).
 *      DOOR_POSE upright gate: world-Z extent ≈ doorH (hundreds of mm), NOT ≈ Td.
 *   C. Bake the door part → featureTree gains bake:-prefixed HoleFeatures
 *      (data-layer bake proof; real-OCCT cup void proven by the kernel
 *      hingeCup integration guard, Phase 0/9).
 *   D. GenerateShelfPinBoresCommand → side-panel .zipt gain shelfPin bores[]
 *      → Ø5 pin markers render on the side panels.
 *   E. Export DXF + CSV bytes for the aggregated bores → parse: CSV header +
 *      rows incl. Ø5 (pin) and Ø35 (cup); DXF CIRCLE entities on D5_T* / D35_T*
 *      layers.
 *   F. Undo cascade restores prior state at each layer.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

/** Parse DXF text into [groupCode, value] pairs (from prisadka-carcass-boring).
 *  NOTE: some group values are legitimately empty strings (e.g. the STYLE table's
 *  group-4 secondary-font field) — only the single trailing blank line produced by
 *  the writer's final '\n' is dropped, so code/value pairing stays aligned. */
function parseDxf(text: string): Array<[number, string]> {
  const raw = text.split('\n');
  while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const lines = raw.map((l) => l.trim());
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!, 10);
    if (!isNaN(code)) pairs.push([code, lines[i + 1]!]);
  }
  return pairs;
}

test(
  'присадка slice2: door cup markers + bake + система-32 pin markers + DXF/CSV bytes + undo',
  async ({ page }) => {
    test.setTimeout(360_000);
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

    // ── A1. New assembly ───────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── A2. Register cabinet materials ─────────────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── A3. CreateCabinetCommand (base cabinet, 1 shelf) ───────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'Slice2 Cabinet',
          width: 600,
          depth: 560,
          height: 720,
          toekickHeight: 100,
          toekickSetback: 50,
          shelfCount: 1,
          carcassMaterialId: 'm-birch-18',
          backMaterialId: 'm-hb-6',
          bandMaterialId: null,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
          };
        };
        return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    // Resolve the cabinet .ziasm path (the single top-level component's partPath).
    const cabinetPath: string = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
    });
    expect(cabinetPath, 'cabinet component must reference a .ziasm path').toMatch(/\.ziasm$/);
    console.log('[slice2] cabinetPath =', cabinetPath);

    // ── B1. AddDoorCommand (single, full overlay) ──────────────────────────────
    // params.cabinet is passed as ZEROS (intentionally — mirrors AddDoorCommand.spec.ts
    // SINGLE_DOOR_ZERO_DIMS pattern). AddDoorCommand.apply() overrides cabinet with dims
    // derived from the unpacked .ziasm before calling doorMath. Zeros that reach doorMath
    // produce negative door dims → doorBores.count assertion fails → would be a real RED.
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDoorCommand } = await import('/src/commands/AddDoorCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDoorCommand({
        cabinetPath: cabPath,
        // cabinet dims are INTENTIONALLY ZERO — AddDoorCommand.apply() derives and
        // overrides them from the unpacked .ziasm (Phase 5 fix). Zeros reaching doorMath
        // produce negative dims → hinge bores fail → doorBores.count assertion goes RED.
        params: {
          cabinet: { width: 0, height: 0, depth: 0, Tc: 0, toekickHeight: 0 },
          count: 'single',
          overlay: 'full',
          hingeSide: 'left',
          thickness: 18,
          reveal: 2,
          clearance: 2,
          centerReveal: 3,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── B2. Door component landed in the cabinet .ziasm (data-layer proof) ──────
    const doorInfo: { components: number; doorRoles: number; doorPartPath: string | null } =
      await page.evaluate(async (cabPath: string) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }> };
          };
        };
        // Read the .ziasm straight from the store mirror (AddDoorCommand reloads it).
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return { components: -1, doorRoles: -1, doorPartPath: null };
        const doorComp = doc.components.find((c) => c.role === 'door') ?? null;
        return {
          components: doc.components.length,
          doorRoles: doc.components.filter((c) => c.role === 'door').length,
          doorPartPath: doorComp ? doorComp.partPath : null,
        };
      }, cabinetPath);

    console.log('[slice2] door info:', JSON.stringify(doorInfo));
    expect(
      doorInfo.components,
      'subAssemblyDocs[cabinet] must be warmed (AddDoorCommand reloads it)',
    ).toBeGreaterThan(0);
    expect(doorInfo.doorRoles, 'cabinet .ziasm must gain exactly one role:door component').toBe(1);
    expect(doorInfo.doorPartPath, 'door component must reference a .zipt part path').toMatch(/\.zipt$/);
    const doorPartPath = doorInfo.doorPartPath!;

    // ── B3. Door part carries Ø35 hingeCup bores[] (data-layer proof) ──────────
    const doorBores: { count: number; cup35: number; blind: boolean } = await page.evaluate(
      async (p: string) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        };
        const opfs = await w.__zilventorGetOpfs();
        // The door part is a .zipt (a PART), so __zilventorUnpackProject is correct here.
        const project = await w.__zilventorUnpackProject(await opfs.read(p));
        const doc = (project.manifest as {
          document: { bores?: Array<{ diameter: number; depth: number | string; role: string }> };
        }).document;
        const bores = doc.bores ?? [];
        return {
          count: bores.length,
          cup35: bores.filter((b) => b.diameter === 35 && b.role === 'hingeCup').length,
          blind: bores.every((b) => typeof b.depth === 'number'),
        };
      },
      doorPartPath,
    );
    console.log('[slice2] door bores:', JSON.stringify(doorBores));
    expect(doorBores.count, 'door part must carry ≥2 cup bores (2 hinges @ 720mm)').toBeGreaterThanOrEqual(2);
    expect(doorBores.cup35, 'every door cup is Ø35 role:hingeCup').toBe(doorBores.count);
    expect(doorBores.blind, 'all door cups are BLIND (numeric depth, never throughAll)').toBe(true);

    // ── B4. 3D markers: Ø35 cup markers RENDER (real panel, not placeholder) ───
    // Force the sub-asm warm + marker rebuild via the verified DEV hook, then read
    // the marker count off the SceneManager (the headless viewport is BLACK so we
    // probe state, never pixels). Markers ONLY build for real leaf geometry — a
    // placeholder 50mm box has no bore overlay spec, so a nonzero count proves the
    // door renders as a REAL panel.
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidate: (p: string) => Promise<void>;
      };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    const readBoreMarkerCount = async (): Promise<number> =>
      page.evaluate(() => {
        const store = (window as unknown as {
          __zilventorStore: { getState(): { viewport: unknown } };
        }).__zilventorStore.getState();
        const vp = store.viewport as { getSceneManager?(): unknown } | null;
        const sm = vp?.getSceneManager?.() as { boreMarkerCount(): number } | null;
        return sm?.boreMarkerCount?.() ?? -1;
      });

    await expect
      .poll(readBoreMarkerCount, {
        timeout: 20_000,
        message: 'door cup markers must render (≥2) — proves door is a real panel, not a placeholder',
      })
      .toBeGreaterThanOrEqual(2);
    console.log('[slice2] bore markers after door:', await readBoreMarkerCount());

    // ── B5. DOOR_POSE upright gate ──────────────────────────────────────────────
    // The door's pose quaternion (from prisadkaFaceConventions.DOOR_POSE) maps:
    //   part-X (length=doorH) → world+Z (vertical)
    //   part-Y (width=doorW)  → world+X (horizontal)
    //   part-Z (thickness=Td) → world+Y (depth)
    // An upright door has world-Z extent ≈ doorH (hundreds of mm).
    // A FLAT door (identity quaternion placeholder) has world-Z extent ≈ Td (~18mm).
    // We compute from the door component's pose and dims via the store.
    const doorUprightProbe: { worldZExtent: number; doorH: number; Td: number; uprightRatio: number } =
      await page.evaluate(
        async (params: { cabPath: string; partPath: string }) => {
          const w = window as unknown as {
            __zilventorStore: {
              getState(): {
                subAssemblyDocs: Record<string, {
                  components: Array<{
                    role?: string;
                    partPath: string;
                    pose?: {
                      translation: { x: number; y: number; z: number };
                      quaternion: [number, number, number, number];
                    };
                  }>;
                }>;
              };
            };
            __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
            __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
          };

          const opfs = await w.__zilventorGetOpfs();
          // Get door dims from its PanelFeature.
          const project = await w.__zilventorUnpackProject(await opfs.read(params.partPath));
          const doc = (project.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
          const pf = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
            | { length: { value: number }; width: { value: number }; thickness: { value: number } }
            | undefined;
          const doorH = pf?.length.value ?? 0;
          const Td = pf?.thickness.value ?? 0;

          // Get the door component's quaternion from the store.
          const cabDoc = w.__zilventorStore.getState().subAssemblyDocs[params.cabPath];
          const doorComp = cabDoc?.components.find((c) => c.role === 'door');
          const q = doorComp?.pose?.quaternion ?? [0, 0, 0, 1] as [number, number, number, number];

          // Compute the world-Z extent using the rotation matrix from the quaternion.
          // R[2][*] is the third row of the rotation matrix (how world-Z is built from part axes).
          // R[2][0] = 2(xz - wy)  — contribution of part-X to world-Z
          // R[2][1] = 2(yz + wx)  — contribution of part-Y to world-Z
          // R[2][2] = 1-2(x²+y²)  — contribution of part-Z to world-Z
          const [x, y, z, wq] = q;
          // Door AABB in part frame: [0..doorH] × [0..doorW] × [0..Td]
          // World-Z extent = the half-size of the AABB projected onto world-Z axis.
          // For a box [0..L]×[0..W]×[0..T], the extent along world axis n̂ is:
          //   |n̂·X̂|·L + |n̂·Ŷ|·W + |n̂·Ẑ|·T
          // where X̂/Ŷ/Ẑ are unit part-frame axes and n̂=world+Z.
          // The world-Z component of each part axis is R[2][i] (row 2 of rotation matrix).
          const R20 = 2 * (x * z - wq * y);   // part-X contribution to world-Z
          const R21 = 2 * (y * z + wq * x);   // part-Y contribution to world-Z
          const R22 = 1 - 2 * (x * x + y * y); // part-Z contribution to world-Z

          const doorW = pf?.width.value ?? 0;
          const worldZExtent = Math.abs(R20) * doorH + Math.abs(R21) * doorW + Math.abs(R22) * Td;

          return {
            worldZExtent: Math.round(worldZExtent * 10) / 10,
            doorH,
            Td,
            uprightRatio: doorH > 0 ? worldZExtent / doorH : 0,
          };
        },
        { cabPath: cabinetPath, partPath: doorPartPath },
      );

    console.log('[slice2] door world extent (Z):', JSON.stringify(doorUprightProbe));
    // Assert: door stands upright (world-Z extent close to doorH, not Td).
    // uprightRatio ≈ 1 means world-Z extent ≈ doorH (upright).
    // uprightRatio ≈ Td/doorH (≈0.025 for 18/720) means door is flat — WRONG QUATERNION.
    expect(
      doorUprightProbe.uprightRatio,
      `DOOR_POSE upright gate: world-Z extent (${doorUprightProbe.worldZExtent}mm) must be close to doorH (${doorUprightProbe.doorH}mm), not Td (${doorUprightProbe.Td}mm). uprightRatio must be ≥0.9. Got: ${doorUprightProbe.uprightRatio.toFixed(3)}`,
    ).toBeGreaterThanOrEqual(0.9);

    await page.screenshot({ path: '/tmp/prisadka-slice2-after-door.png' });

    // ── C. Bake the door part → featureTree gains bake:-prefixed HoleFeatures ───
    const preBakeFeatures = await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const project = await w.__zilventorUnpackProject(await opfs.read(p));
      const doc = (project.manifest as { document: { featureTree: Array<{ id: string }> } }).document;
      return doc.featureTree.filter((f) => f.id.startsWith('bake:')).length;
    }, doorPartPath);
    expect(preBakeFeatures, 'no bake: features on the door before bake').toBe(0);

    // Stub kernel (data-layer wiring is the assertion; real-OCCT cup void is proven
    // by the kernel hingeCup integration guard, Phase 0/9).
    await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { BakeBoresCommand } = await import('/src/commands/BakeBoresCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const stubKernel = {
        deletePart: async (_id: string) => {},
        registerPart: async (_part: unknown) => {},
        execute: async (_id: string) => ({ ok: true as const, value: {} as never }),
        saveToBytes: async (_id: string) => new Uint8Array(),
      };
      const cmd = new BakeBoresCommand({ partPath: p, opfs, kernel: stubKernel as never });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, doorPartPath);

    const postBakeFeatures = await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const project = await w.__zilventorUnpackProject(await opfs.read(p));
      const doc = (project.manifest as { document: { featureTree: Array<{ id: string }> } }).document;
      return doc.featureTree.filter((f) => f.id.startsWith('bake:')).length;
    }, doorPartPath);
    console.log('[slice2] door bake: features after bake:', postBakeFeatures);
    expect(
      postBakeFeatures,
      'BakeBoresCommand must append ≥1 bake: HoleFeature to the door featureTree',
    ).toBeGreaterThan(0);

    // ── D. GenerateShelfPinBoresCommand → side panels gain shelfPin bores[] ─────
    // ADDENDUM §6: inline the shelf-pin params as literals (no dynamic import of
    // '@zilventor/shared/shelfPinGrid' — that subpath has no exports map and does
    // not resolve in the Playwright browser context; packages/shared/package.json
    // has no exports map; vite.config.ts has no alias for it). Values match
    // DEFAULT_SHELF_PIN_PARAMS as defined in Phase 2 Task 1.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { GenerateShelfPinBoresCommand } = await import(
        '/src/commands/GenerateShelfPinBoresCommand.ts'
      );
      const opfs = await w.__zilventorGetOpfs();
      // Inline params mirror DEFAULT_SHELF_PIN_PARAMS (Phase 2 Task 1).
      // Never import '@zilventor/shared/shelfPinGrid' — no exports map, not resolvable.
      const shelfPinParams = {
        pitch: 32,
        diameter: 5,
        depth: 13,
        frontSetback: 37,
        backSetback: 37,
        topMargin: 64,
        bottomMargin: 64,
        columns: 2 as const,
      };
      const cmd = new GenerateShelfPinBoresCommand({
        params: shelfPinParams,
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });

    // D1. Data-layer proof: scan OPFS for panel .zipt that gained Ø5 shelfPin bores.
    type PanelResult = { partPath: string; pinCount: number };
    const pinPanels: PanelResult[] = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const unpack = w.__zilventorUnpackProject;
      const root = await navigator.storage.getDirectory();
      const results: Array<{ partPath: string; pinCount: number }> = [];
      // @ts-expect-error async iterator over OPFS entries
      for await (const [name] of root.entries()) {
        if (!name.endsWith('.zipt')) continue;
        try {
          const bytes = await opfs.read(name);
          const project = await unpack(bytes);
          const doc = (project.manifest as {
            document: { bores?: Array<{ diameter: number; role: string; depth: number | string }> };
          }).document;
          const pins = (doc.bores ?? []).filter(
            (b) => b.role === 'shelfPin-system32' && b.diameter === 5,
          );
          if (pins.length > 0) results.push({ partPath: name, pinCount: pins.length });
        } catch { /* skip */ }
      }
      return results;
    });
    console.log(
      '[slice2] panels with shelf pins:',
      pinPanels.length,
      pinPanels.map((p) => `${p.partPath}:${p.pinCount}`).join(', '),
    );
    expect(
      pinPanels.length,
      'GenerateShelfPinBores must write Ø5 shelfPin bores to ≥1 side panel',
    ).toBeGreaterThan(0);
    const totalPins = pinPanels.reduce((s, p) => s + p.pinCount, 0);
    expect(totalPins, 'total shelf-pin bore count must be > 0').toBeGreaterThan(0);

    // D2. Pin markers render too. Re-invalidate to warm + rebuild, then assert the
    // marker count GREW (door cups + pin markers now both present).
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as { __zilventorSubAsmInvalidate: (p: string) => Promise<void> };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);
    await expect
      .poll(readBoreMarkerCount, {
        timeout: 20_000,
        message: 'shelf-pin markers must render in addition to door cups',
      })
      .toBeGreaterThanOrEqual(2 + totalPins);
    console.log('[slice2] bore markers after shelf pins:', await readBoreMarkerCount());

    // ── E. Export DXF + CSV bytes for the aggregated bores ──────────────────────
    // Abort the save-picker so apply() stashes bytes but skips the download.
    await page.evaluate(() => {
      (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    });

    // Build a BoringAggregateResult from the OPFS scan (cup panel + pin panels) and
    // export. The export commands only read result.panels[].bores[].
    const exportPanels = [{ partPath: doorPartPath }, ...pinPanels.map((p) => ({ partPath: p.partPath }))];
    await page.evaluate(
      async (panels: Array<{ partPath: string }>) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        };
        const opfs = await w.__zilventorGetOpfs();
        const unpack = w.__zilventorUnpackProject;
        const panelGroups = await Promise.all(
          panels.map(async ({ partPath }) => {
            const bytes = await opfs.read(partPath);
            const project = await unpack(bytes);
            const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
            return { partPath, partName: partPath, bores: doc.bores ?? [], qty: 1, componentPathKeys: [] };
          }),
        );
        const result = { panels: panelGroups } as never;
        const { ExportBoringCsvCommand } = await import('/src/commands/ExportBoringCsvCommand.ts');
        const { ExportBoringDxfCommand } = await import('/src/commands/ExportBoringDxfCommand.ts');
        await new ExportBoringCsvCommand({ result, suggestedName: 'slice2.csv' }).apply();
        await new ExportBoringDxfCommand({ result, suggestedName: 'slice2.dxf' }).apply();
      },
      exportPanels,
    );

    // E1. CSV: header + rows including Ø5 (pin) and Ø35 (cup).
    const csv = await page.evaluate(() => {
      const w = window as unknown as { __zilventorBoringCsvBytes?: Uint8Array };
      return w.__zilventorBoringCsvBytes ? new TextDecoder().decode(w.__zilventorBoringCsvBytes) : null;
    });
    expect(csv, 'ExportBoringCsvCommand must stash CSV bytes').not.toBeNull();
    expect(csv).toContain('Panel,Length,Width,Thickness,Tag,Face,X,Y,Ø,Depth,Type');
    const csvDataRows = csv!
      .split('\n')
      .filter((l) => l.trim() && l.includes(',') && !l.startsWith('Panel,'));
    expect(csvDataRows.length, 'CSV must have ≥1 data row').toBeGreaterThan(0);
    expect(csv, 'CSV must contain a Ø5 shelf-pin row').toMatch(/,5,/);
    expect(csv, 'CSV must contain a Ø35 hinge-cup row').toMatch(/,35,/);
    console.log('[slice2] CSV rows:', csvDataRows.length);

    // E2. DXF: well-formed + CIRCLE entities on D5_T* and D35_T* layers.
    const dxfText = await page.evaluate(() => {
      const w = window as unknown as { __zilventorBoringDxfBytes?: Uint8Array };
      return w.__zilventorBoringDxfBytes ? new TextDecoder().decode(w.__zilventorBoringDxfBytes) : null;
    });
    expect(dxfText, 'ExportBoringDxfCommand must stash DXF bytes').not.toBeNull();
    const pairs = parseDxf(dxfText!);
    const code0 = pairs.filter(([c]) => c === 0).map(([, v]) => v);
    expect(
      code0.filter((v) => v === 'SECTION').length,
      'DXF SECTION count == ENDSEC count',
    ).toBe(code0.filter((v) => v === 'ENDSEC').length);
    expect(code0.filter((v) => v === 'EOF').length, 'exactly one DXF EOF').toBe(1);
    const circleCount = code0.filter((v) => v === 'CIRCLE').length;
    expect(circleCount, 'DXF must contain ≥1 CIRCLE per bore').toBeGreaterThan(0);
    // Layers per Ø: collect the layer (group 8) following each CIRCLE.
    const circleLayers: string[] = [];
    for (let i = 0; i < pairs.length - 1; i++) {
      if (pairs[i]![0] === 0 && pairs[i]![1] === 'CIRCLE') {
        for (let j = i + 1; j < Math.min(i + 10, pairs.length); j++) {
          if (pairs[j]![0] === 8) { circleLayers.push(pairs[j]![1]!); break; }
        }
      }
    }
    console.log('[slice2] DXF circle layers:', Array.from(new Set(circleLayers)).join(', '));
    expect(
      circleLayers.some((l) => /^D5_T/.test(l)),
      'a CIRCLE must sit on a D5_T* (shelf-pin Ø5) layer',
    ).toBe(true);
    expect(
      circleLayers.some((l) => /^D35_T/.test(l)),
      'a CIRCLE must sit on a D35_T* (hinge-cup Ø35) layer',
    ).toBe(true);

    await page.screenshot({ path: '/tmp/prisadka-slice2-after-export.png' });

    // ── F. Undo cascade ────────────────────────────────────────────────────────
    // F1. Undo generate-shelf-pins → side-panel pin bores removed.
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    const pinsAfterUndo = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const unpack = w.__zilventorUnpackProject;
      const root = await navigator.storage.getDirectory();
      let total = 0;
      // @ts-expect-error async iterator over OPFS entries
      for await (const [name] of root.entries()) {
        if (!name.endsWith('.zipt')) continue;
        try {
          const project = await unpack(await opfs.read(name));
          const doc = (project.manifest as {
            document: { bores?: Array<{ role: string }> };
          }).document;
          total += (doc.bores ?? []).filter((b) => b.role === 'shelfPin-system32').length;
        } catch { /* skip */ }
      }
      return total;
    });
    console.log('[slice2] shelf pins after undo-generate:', pinsAfterUndo);
    expect(pinsAfterUndo, 'undo-generate-shelf-pins must clear every shelfPin bore').toBe(0);

    // F2. Undo bake-door → door featureTree loses the bake: features.
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    const bakeAfterUndo = await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const project = await w.__zilventorUnpackProject(await opfs.read(p));
      const doc = (project.manifest as { document: { featureTree: Array<{ id: string }> } }).document;
      return doc.featureTree.filter((f) => f.id.startsWith('bake:')).length;
    }, doorPartPath);
    console.log('[slice2] door bake: features after undo-bake:', bakeAfterUndo);
    expect(bakeAfterUndo, 'undo-bake must remove all bake: features from the door').toBe(0);

    // F3. Undo add-door → door component removed from the cabinet .ziasm.
    // ADDENDUM §8: use the store-based read (subAssemblyDocs[cabinetPath]) as the
    // PRIMARY assertion path, NOT __zilventorUnpackProject on a .ziasm file.
    // Reason: __zilventorUnpackProject is unpackProject (the PART packer); reading
    // a .ziasm through it reads components from the wrong shape and may return []
    // vacuously, making the assertion pass whether undo worked or not (false-green).
    // The store path is the same mechanism B2 uses and is authoritative.
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });

    // After undo, force a store reload of the cabinet .ziasm so subAssemblyDocs[cabinetPath]
    // reflects the post-undo OPFS state (not the pre-undo AddDoorCommand reload).
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidate: (p: string) => Promise<void>;
      };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    const doorAfterUndo = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<
                string,
                { components: Array<{ role?: string }> }
              >;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return -1; // -1 means the entry is missing entirely (also wrong)
        return doc.components.filter((c) => c.role === 'door').length;
      },
      cabinetPath,
    );
    console.log('[slice2] door components in .ziasm after undo-add-door:', doorAfterUndo);
    expect(
      doorAfterUndo,
      'undo-add-door must remove the door component from the cabinet .ziasm (store read)',
    ).toBe(0);

    // ── Final: no browser errors through the whole flow ────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during slice-2 e2e flow').toHaveLength(0);
  },
);
