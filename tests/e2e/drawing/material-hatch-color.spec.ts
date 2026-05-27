// tests/e2e/drawing/material-hatch-color.e2e.ts
/**
 * T-material-hatch-color — Assembly-sourced section view: ≥2 distinct material hatch colors.
 *
 * Proves that Tasks 1–9 of the material-colored-section-hatch plan produce REAL,
 * distinguishable hatch colors per component, on:
 *   (a) the canvas DOM (data-role="hatch" line stroke attributes)
 *   (b) the SVG export (renderDrawingSvg hatch line strokes)
 *   (c) the DXF export (renderDrawingDxf SECTION-HATCH LINE group-62 ACI values)
 *
 * Two boxes (30×30×20, Part A at x=0, Part B at x=+100mm) are given DISTINCT materials:
 *   Part A: materials[0].color = '#aa0000'  (r=170,g=0,b=0 → nearest ACI 40 = [128,64,0])
 *   Part B: materials[0].color = '#0000bb'  (near-blue → nearest ACI 5 = [0,0,255])
 *
 * Color injection: after buildBox+saveToBytes, repack the raw bytes via
 * window.__zilventorPackProject / dynamic import of unpackProject — splice a
 * materials array into the manifest before repacking. This ensures
 * loadAssemblyForProjection.ts will find materials[0].color and populate
 * activeDrawingSourceComponentColors correctly.
 *
 * Section is a HORIZONTAL CUT (front base view, section line at view-y=0) cutting
 * through both boxes — both component cut-faces carry distinct partIds → distinct colors.
 *
 * Dev hooks used:
 *   - window.__zilventorStore
 *   - window.__zilventorPackAssembly
 *   - window.__zilventorPackProject  (= packProject from ProjectPacker.ts)
 *   - dynamic import('/src/commands/CreateDrawingCommand.ts')
 *   - dynamic import('/src/commands/AddBaseViewCommand.ts')
 *   - dynamic import('/src/commands/AddSectionViewCommand.ts')
 *   - dynamic import('/src/drawing/renderDrawingSvg.ts')
 *   - dynamic import('/src/drawing/renderDrawingDxf.ts')
 *   - dynamic import('@zilventor/kernel/src/storage/ProjectPacker.ts')
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

const ASM_PATH = 'assemblies/t-mhc.ziasm';
const PART_A_PATH = 'parts/t-mhc-A.zipt';
const PART_B_PATH = 'parts/t-mhc-B.zipt';

// Colors chosen so hexToAci maps them to distinct ACI values:
//   #aa0000 → nearest to [255,0,0] ACI=1 (red)
//   #0000bb → nearest to [0,0,255] ACI=5 (blue)
const COLOR_A = '#aa0000';
const COLOR_B = '#0000bb';

test('material-hatch-color: assembly section view → ≥2 distinct hatch colors on canvas + SVG + DXF', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    const text = m.text();
    console.log('BROWSER:', m.type(), text);
    if (m.type() === 'error') consoleErrors.push(text);
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(`PAGEERROR: ${e.message}`);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // ── Helper: OPFS write ─────────────────────────────────────────────────────
  // (declared inline in each page.evaluate for serialization simplicity)

  // ── Step 1: Build Part A (30×30×20) via UI ───────────────────────────────
  await buildBox(page, { width: 30, height: 30, depth: 20 });

  const { partIdA } = await page.evaluate(
    async ({ partAPath, colorA }: { partAPath: string; colorA: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const segments = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < segments.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segments[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(segments[segments.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('mhc step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const rawBytesA = await s.kernel.saveToBytes(s.activePart.id);

      // Inject material color into Part A's manifest, then repack.
      // This ensures loadAssemblyForProjection picks up the color.
      const w2 = window as unknown as {
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array }>;
        __zilventorPackProject: (input: { manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array }) => Promise<Uint8Array>;
      };
      if (!w2.__zilventorUnpackProject) throw new Error('mhc step 1: __zilventorUnpackProject not found');
      if (!w2.__zilventorPackProject) throw new Error('mhc step 1: __zilventorPackProject not found');

      const { manifest, blobs, thumbnail } = await w2.__zilventorUnpackProject(rawBytesA);

      // Splice materials[0].color into the manifest document.
      const mutableManifest = manifest as {
        kind?: string;
        document?: { materials?: Array<{ id: string; name: string; defaultThickness: number; color: string }> };
      };
      if (!mutableManifest.document) mutableManifest.document = {};
      if (!mutableManifest.document.materials) mutableManifest.document.materials = [];
      mutableManifest.document.materials = [
        { id: 'mat-a', name: 'Red Material', defaultThickness: 18, color: colorA },
      ];

      const bytesA = await w2.__zilventorPackProject({ manifest: mutableManifest, blobs, thumbnail });
      await opfsWrite(partAPath, bytesA);
      console.log('[mhc] Part A bytes written with color', colorA, 'length=', bytesA.length);

      return { partIdA: s.activePart.id };
    },
    { partAPath: PART_A_PATH, colorA: COLOR_A },
  );

  // ── Step 2: Build Part B (30×30×20) via UI ──────────────────────────────
  await buildBox(page, { width: 30, height: 30, depth: 20 });

  const { partIdB } = await page.evaluate(
    async ({ partBPath, colorB }: { partBPath: string; colorB: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const segments = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < segments.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segments[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(segments[segments.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('mhc step 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const rawBytesB = await s.kernel.saveToBytes(s.activePart.id);

      // Inject material color into Part B's manifest.
      const w2 = window as unknown as {
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array }>;
        __zilventorPackProject: (input: { manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array }) => Promise<Uint8Array>;
      };
      if (!w2.__zilventorUnpackProject) throw new Error('mhc step 2: __zilventorUnpackProject not found');
      if (!w2.__zilventorPackProject) throw new Error('mhc step 2: __zilventorPackProject not found');

      const { manifest, blobs, thumbnail } = await w2.__zilventorUnpackProject(rawBytesB);

      const mutableManifest = manifest as {
        kind?: string;
        document?: { materials?: Array<{ id: string; name: string; defaultThickness: number; color: string }> };
      };
      if (!mutableManifest.document) mutableManifest.document = {};
      if (!mutableManifest.document.materials) mutableManifest.document.materials = [];
      mutableManifest.document.materials = [
        { id: 'mat-b', name: 'Blue Material', defaultThickness: 18, color: colorB },
      ];

      const bytesB = await w2.__zilventorPackProject({ manifest: mutableManifest, blobs, thumbnail });
      await opfsWrite(partBPath, bytesB);
      console.log('[mhc] Part B bytes written with color', colorB, 'length=', bytesB.length);

      return { partIdB: s.activePart.id };
    },
    { partBPath: PART_B_PATH, colorB: COLOR_B },
  );

  // ── Step 3: Pack .ziasm (Part A at x=0, Part B at x=+100mm) ─────────────
  await page.evaluate(
    async ({ asmPath, partAPath, partBPath, partIdA, partIdB }: {
      asmPath: string; partAPath: string; partBPath: string;
      partIdA: string; partIdB: string;
    }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const segments = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < segments.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segments[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(segments[segments.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const asmDoc = {
        id: 'asm-mhc',
        name: 'MHC Assembly',
        units: 'mm',
        parameters: {},
        components: [
          {
            id: partIdA,
            partPath: partAPath,
            position: { x: 0, y: 0, z: 0 },
            rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
            flexible: false,
          },
          {
            id: partIdB,
            partPath: partBPath,
            position: { x: 100, y: 0, z: 0 }, // +100mm X — non-overlapping, both cut by horizontal plane
            rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
            flexible: false,
          },
        ],
        constraints: [],
        groundedComponentPaths: [],
        bomItemNumbers: {},
        cutListItemNumbers: {},
        colorOverrides: {},
        colors: {},
        properties: {},
        materials: [],
        hardware: [],
      };

      const w = window as unknown as {
        __zilventorPackAssembly: (doc: unknown, thumb: Uint8Array) => Promise<Uint8Array>;
      };
      if (!w.__zilventorPackAssembly) throw new Error('mhc step 3: __zilventorPackAssembly not found');

      const png = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      const archive = await w.__zilventorPackAssembly(asmDoc, png);
      await opfsWrite(asmPath, archive);

      const store = (window as unknown as {
        __zilventorStore: { setState(p: unknown): void };
      }).__zilventorStore;
      store.setState({ activeAssembly: asmDoc } as never);
      console.log('[mhc] Assembly packed and seeded in store');
    },
    { asmPath: ASM_PATH, partAPath: PART_A_PATH, partBPath: PART_B_PATH, partIdA, partIdB },
  );

  // ── Steps 4–6: CreateDrawing + base view + section view ──────────────────
  const { sheetId, sectionViewId, drawingDocSnapshot, initialHatchColors } = await page.evaluate(
    async ({ asmPath, partIdA: pA }: { asmPath: string; partIdA: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: {
                id: string;
                sheets: Array<{
                  id: string;
                  views: Array<{
                    id: string;
                    kind: string;
                    hatchSegments?: Array<{ color?: string; p0?: { x: number; y: number }; p1?: { x: number; y: number } }>;
                    projection?: { visibleEdges: unknown[]; bbox: { minX: number; minY: number; maxX: number; maxY: number } };
                  }>;
                }>;
              };
            } | null;
            activeDrawingSourceFingerprint: string | null;
            activeDrawingSourceComponents: Array<{ partId: string; pose: unknown }> | null;
            activeDrawingSourceComponentColors: Record<string, string> | null;
            activePart: { id: string } | null;
            activeDrawingSourcePartId: string | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              getProjectorInput(args: { kind: string; partId: string }): Promise<{ bbox: readonly number[] } | null>;
            } | null;
          };
          setState(p: unknown): void;
        };
      }).__zilventorStore;

      // Warm the kernel for Part A (required by AddSectionViewCommand namedShapeCache).
      const s0 = store.getState();
      if (s0.kernel && pA) await s0.kernel.execute(pA);

      // Step 4: Create drawing (assembly source).
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath: asmPath, sourceKind: 'assembly' }).apply();

      const s1 = store.getState();
      const componentColors1 = s1.activeDrawingSourceComponentColors;
      console.log('[mhc] After CreateDrawingCommand, componentColors:', JSON.stringify(componentColors1));

      if (!s1.activeDrawingSourceComponents || s1.activeDrawingSourceComponents.length < 2) {
        throw new Error(
          `mhc: activeDrawingSourceComponents must have ≥2 entries. Got: ${JSON.stringify(s1.activeDrawingSourceComponents)}`,
        );
      }
      if (!componentColors1 || Object.keys(componentColors1).length < 2) {
        throw new Error(
          `mhc: activeDrawingSourceComponentColors must have ≥2 entries (colors for both parts). Got: ${JSON.stringify(componentColors1)}`,
        );
      }

      const drawing = (s1.activeDocument as {
        document: { id: string; sheets: Array<{ id: string }> };
      }).document;
      const sheetId = drawing.sheets[0]!.id;

      // Step 5: AddBaseViewCommand (front, 1:1).
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = (s2.activeDocument as {
        document: {
          sheets: Array<{
            id: string;
            views: Array<{
              id: string;
              kind: string;
              projection?: { visibleEdges: unknown[]; bbox: { minX: number; minY: number; maxX: number; maxY: number } };
            }>;
          }>;
        };
      }).document;
      const sh2 = doc2.sheets.find((s) => s.id === sheetId)!;
      const baseView = sh2.views.find((v) => v.kind === 'base')!;
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error('mhc: base view has no projected edges');
      }

      // Patch base view with viewMatrix (required by AddSectionViewCommand).
      {
        const components = s2.activeDrawingSourceComponents as Array<{ partId: string }> | null;
        const partKernelId = s2.activeDrawingSourcePartId
          ?? s2.activePart?.id
          ?? components?.[0]?.partId;
        if (!partKernelId || !s2.kernel) throw new Error('mhc: kernel or partId not available for viewMatrix patch');
        const input = await s2.kernel.getProjectorInput({ kind: 'part', partId: partKernelId });
        if (!input) throw new Error('mhc: getProjectorInput returned null — part not cached');
        const [minX, minY, minZ, maxX, maxY, maxZ] = input.bbox;
        const cx = ((minX as number) + (maxX as number)) / 2;
        const cy = ((minY as number) + (maxY as number)) / 2;
        const cz = ((minZ as number) + (maxZ as number)) / 2;
        const vm = [1, 0, 0, -cx, 0, 1, 0, -cy, 0, 0, 1, -cz, 0, 0, 0, 1];

        const cDoc = store.getState().activeDocument!.document;
        const patched = {
          ...cDoc,
          sheets: (cDoc as { sheets: Array<{ id: string; views: Array<Record<string, unknown>> }> }).sheets.map((sh) =>
            sh.id !== sheetId ? sh : {
              ...sh,
              views: sh.views.map((v) =>
                (v as { id: string })['id'] !== baseView.id ? v : { ...v, viewMatrix: vm }
              ),
            }
          ),
        };
        store.setState({
          activeDocument: { kind: 'drawing', document: patched },
          activeDrawing: patched,
        });
      }

      // Step 6: AddSectionViewCommand — full mode, horizontal cut at view-y=0.
      const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
      await new AddSectionViewCommand({
        drawingId: drawing.id,
        sheetId,
        parentViewId: baseView.id,
        p0: { x: -20, y: 0 },
        p1: { x: 20, y: 0 },
        arrowDirection: 1 as -1 | 1,
        dropAt: { x: 200, y: 80 },
        mode: 'full',
      }).apply();

      const s3 = store.getState();
      const sh3 = (s3.activeDocument as {
        document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; hatchSegments?: Array<{ color?: string }> }> }> };
      }).document.sheets.find((s) => s.id === sheetId)!;
      const sectionView = sh3.views.find((v) => v.kind === 'section')!;
      if (!sectionView) throw new Error('mhc: section view not found after AddSectionViewCommand');

      const hatchSegs = sectionView.hatchSegments ?? [];
      const initialHatchColors = [...new Set(hatchSegs.map((s) => s.color ?? '(undefined)'))];
      console.log('[mhc] hatchSegments after AddSectionViewCommand:', hatchSegs.length,
        'distinct colors:', JSON.stringify(initialHatchColors));

      // Capture the full drawing document for SVG/DXF render calls.
      const drawingDocSnapshot = (s3.activeDocument as { document: unknown }).document;

      return { sheetId, sectionViewId: sectionView.id, drawingDocSnapshot, initialHatchColors };
    },
    { asmPath: ASM_PATH, partIdA },
  );

  // ── Assert: initial hatch has ≥2 distinct colors ─────────────────────────
  console.log('[mhc] Initial hatch distinct colors:', JSON.stringify(initialHatchColors));
  expect(
    initialHatchColors.length,
    `Expected ≥2 distinct hatch colors after AddSectionViewCommand. Got: ${JSON.stringify(initialHatchColors)}`,
  ).toBeGreaterThanOrEqual(2);
  expect(initialHatchColors, 'Canvas hatch must include COLOR_A (#aa0000)').toContainEqual(COLOR_A);
  expect(initialHatchColors, 'Canvas hatch must include COLOR_B (#0000bb)').toContainEqual(COLOR_B);

  // ── Step 7: Switch to Drawing tab; assert canvas DOM has ≥2 distinct hatch colors ──
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // Wait for section view to render on canvas.
  await expect(
    page.locator(`g[data-view-id="${sectionViewId}"] line[data-role="hatch"]`).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Collect all distinct stroke colors from hatch lines in the section view.
  const canvasHatchColors = await page.evaluate(({ svId }: { svId: string }) => {
    const lines = Array.from(
      document.querySelectorAll<SVGLineElement>(`g[data-view-id="${svId}"] line[data-role="hatch"]`),
    );
    const colors = new Set(lines.map((l) => l.getAttribute('stroke') ?? ''));
    return [...colors];
  }, { svId: sectionViewId });

  console.log('[mhc] Canvas hatch DOM distinct stroke colors:', JSON.stringify(canvasHatchColors));
  expect(
    canvasHatchColors.length,
    `Canvas must have ≥2 distinct hatch stroke colors. Got: ${JSON.stringify(canvasHatchColors)}`,
  ).toBeGreaterThanOrEqual(2);
  expect(canvasHatchColors, `Canvas hatch must include ${COLOR_A}`).toContainEqual(COLOR_A);
  expect(canvasHatchColors, `Canvas hatch must include ${COLOR_B}`).toContainEqual(COLOR_B);

  // ── Step 8: SVG export — assert ≥2 distinct hatch stroke colors ──────────
  const svgHatchColors = await page.evaluate(
    async ({ shId, svId }: { shId: string; svId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: unknown } | null;
            activeDrawingSourceDocument: unknown;
          };
        };
      }).__zilventorStore;

      const state = store.getState();
      if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
        throw new Error('mhc SVG: no active drawing document');
      }
      const drawing = state.activeDocument.document as {
        id: string;
        sheets: Array<{ id: string; views: unknown[] }>;
        [k: string]: unknown;
      };
      const sheet = drawing.sheets.find((s) => s.id === shId);
      if (!sheet) throw new Error(`mhc SVG: sheet ${shId} not found`);

      const { renderDrawingSvg } = await import('/src/drawing/renderDrawingSvg.ts');

      // renderDrawingSvg(drawing, sheet, source) — source is used for title block metadata only.
      const svgStr = renderDrawingSvg(
        drawing as Parameters<typeof renderDrawingSvg>[0],
        sheet as Parameters<typeof renderDrawingSvg>[1],
        (state.activeDrawingSourceDocument ?? null) as Parameters<typeof renderDrawingSvg>[2],
      );
      console.log('[mhc] SVG length:', svgStr.length, 'chars');

      // Parse hatch line strokes from SVG string.
      // Format: <line ... stroke="#rrggbb" ... data-role="hatch" .../>
      const hatchLineRe = /data-role="hatch"[^/]*\/|<line[^/]*data-role="hatch"[^>]*>/g;
      const strokeRe = /stroke="([^"]+)"/;

      const hatchColors = new Set<string>();
      // Simpler: find all data-role="hatch" line elements and extract stroke.
      const fullLineRe = /<line\s[^>]*data-role="hatch"[^>]*>/g;
      let m: RegExpExecArray | null;
      while ((m = fullLineRe.exec(svgStr)) !== null) {
        const sm = strokeRe.exec(m[0]);
        if (sm) hatchColors.add(sm[1]!);
      }

      void svId; // only used for logging; section view ID confirmed above
      console.log('[mhc] SVG hatch distinct stroke colors:', JSON.stringify([...hatchColors]));
      return [...hatchColors];
    },
    { shId: sheetId, svId: sectionViewId },
  );

  console.log('[mhc] SVG hatch distinct stroke colors:', JSON.stringify(svgHatchColors));
  expect(
    svgHatchColors.length,
    `SVG export must have ≥2 distinct hatch stroke colors. Got: ${JSON.stringify(svgHatchColors)}`,
  ).toBeGreaterThanOrEqual(2);
  expect(svgHatchColors, `SVG hatch must include ${COLOR_A}`).toContainEqual(COLOR_A);
  expect(svgHatchColors, `SVG hatch must include ${COLOR_B}`).toContainEqual(COLOR_B);

  // ── Step 9: DXF export — assert ≥2 distinct SECTION-HATCH ACI (group-62) values ──
  const dxfAciValues = await page.evaluate(
    async ({ shId }: { shId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: unknown } | null;
            activeDrawingSourceDocument: unknown;
          };
        };
      }).__zilventorStore;

      const state = store.getState();
      if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
        throw new Error('mhc DXF: no active drawing document');
      }
      const drawing = state.activeDocument.document as {
        sheets: Array<{ id: string }>;
        [k: string]: unknown;
      };
      const sheet = drawing.sheets.find((s) => s.id === shId);
      if (!sheet) throw new Error(`mhc DXF: sheet ${shId} not found`);

      const { renderDrawingDxf } = await import('/src/drawing/renderDrawingDxf.ts');
      const dxfStr = renderDrawingDxf(
        drawing as Parameters<typeof renderDrawingDxf>[0],
        sheet as Parameters<typeof renderDrawingDxf>[1],
        (state.activeDrawingSourceDocument ?? null) as Parameters<typeof renderDrawingDxf>[2],
      );
      console.log('[mhc] DXF length:', dxfStr.length, 'chars');

      // Parse DXF: build (group-code, value) pairs.
      const lines = dxfStr.split('\n').map((l) => l.trim());
      const pairs: Array<[number, string]> = [];
      for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = parseInt(lines[i]!, 10);
        if (!Number.isNaN(code)) pairs.push([code, lines[i + 1]!]);
      }

      // Find LINE entities on SECTION-HATCH layer and collect their group-62 (ACI) values.
      const aciValues = new Set<number>();
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i]![0] === 0 && pairs[i]![1] === 'LINE') {
          // Look ahead for group-8 (layer) and group-62 (color).
          let layer = '';
          let aci = -1;
          for (let j = i + 1; j < Math.min(i + 15, pairs.length); j++) {
            if (pairs[j]![0] === 0) break; // next entity
            if (pairs[j]![0] === 8) layer = pairs[j]![1]!;
            if (pairs[j]![0] === 62) aci = parseInt(pairs[j]![1]!, 10);
          }
          if (layer === 'SECTION-HATCH' && aci >= 0) aciValues.add(aci);
        }
      }
      console.log('[mhc] DXF SECTION-HATCH ACI values:', JSON.stringify([...aciValues]));
      return [...aciValues];
    },
    { shId: sheetId },
  );

  console.log('[mhc] DXF SECTION-HATCH distinct ACI values:', JSON.stringify(dxfAciValues));
  expect(
    dxfAciValues.length,
    `DXF export must have ≥2 distinct SECTION-HATCH ACI values. Got: ${JSON.stringify(dxfAciValues)}`,
  ).toBeGreaterThanOrEqual(2);
  // #aa0000 (r=170,g=0,b=0) → nearest ACI is 40 (128,64,0) with d²=5860 vs ACI-1 d²=7225
  // #0000bb (r=0,g=0,b=187) → nearest ACI is 5 (0,0,255) with d²=4624
  expect(dxfAciValues, 'DXF must contain ACI 40 (near-brown/red for Part A #aa0000)').toContain(40);
  expect(dxfAciValues, 'DXF must contain ACI 5 (near-blue for Part B #0000bb)').toContain(5);

  // ── Step 10: Fail on any browser console error ────────────────────────────
  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors detected:\n${consoleErrors.join('\n')}`);
  }

  console.log('[mhc] ALL ASSERTIONS PASSED — canvas:', canvasHatchColors,
    '| SVG:', svgHatchColors, '| DXF ACI:', dxfAciValues);
});
