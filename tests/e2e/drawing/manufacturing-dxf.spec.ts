// tests/e2e/drawing/manufacturing-dxf.spec.ts
/**
 * T-M2.1 — Manufacturing DXF export: real-Chromium zip round-trip.
 *
 * Strategy: Build a minimal PanelManufacturingInput in-browser (no UI nav
 * required — mirrors how prisadka-carcass-boring calls ExportBoringDxfCommand
 * directly). The input has one bore on the Top face (Ø5mm, depth 12mm), which
 * must produce a BORES-FRONT-5MM layer in the output DXF.
 *
 * Steps:
 *  1. Navigate to app, wait for kernel ready.
 *  2. Stub showSaveFilePicker → AbortError so apply() stores bytes in
 *     globalThis.__zilventorManufacturingDxfBytes without triggering a download.
 *  3. Import & call ExportPanelManufacturingDxfCommand with one hand-crafted
 *     PanelManufacturingInput (panel 600×720×18mm, grain:'length', one bore on
 *     Top face, one edge-band, one groove).
 *  4. Read __zilventorManufacturingDxfBytes (ZIP bytes) via page.evaluate.
 *  5. Unzip in Node with fflate.unzipSync; decode the first entry as UTF-8.
 *  6. Assert:
 *     a. ZIP has exactly 2 entries: Birch_18mm/item-1-Side_Panel.dxf + root-level
 *        machining.csv sidecar (W7/D2/S1)
 *     b. DXF contains "OUTLINE" (layer defined/referenced)
 *     c. DXF contains "BORES-FRONT-5MM" (layer for a Ø5 Top-face bore)
 *     d. Exactly 2 DIMENSION entities (horizontal L + vertical W dims)
 *     e. No browser page errors
 *
 * TEETH:
 *  - Exactly-2 DIMENSION count catches accidental extra/missing dim emission.
 *  - BORES-FRONT-5MM layer catch a regression where Top-face bores are silently
 *    skipped or mapped to a wrong layer.
 *  - The globalThis hook (set before showSaveFilePicker is stubbed) means we
 *    never depend on a real file-picker dialog.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { unzipSync, strFromU8 } from 'fflate';

test('T-M2.1: manufacturing DXF export — zip→unzip→layers/dims', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    pageErrors.push(`PAGEERROR: ${e.message}`);
  });
  page.on('console', (m) => {
    console.log('BROWSER:', m.type(), m.text());
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // ── Step 2: Stub showSaveFilePicker to AbortError → bytes go to globalThis ──
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // ── Step 3: Build PanelManufacturingInput and call command in-browser ────────
  await page.evaluate(async () => {
    const { ExportPanelManufacturingDxfCommand } = await import(
      '/src/commands/ExportPanelManufacturingDxfCommand.ts'
    );

    // One bore on the Top face — produces a BORES-FRONT-5MM CIRCLE in the DXF.
    const bore = {
      id: 'bore-t-m2-1',
      face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100,
      v: 80,
      diameter: 5,
      depth: 12,
      role: 'confirmat-face',
      connectorId: 'c0',
      connectorKind: 'confirmat',
    };

    // One groove on Top face (axis:'u') — produces a GROOVES LWPOLYLINE.
    const groove = {
      id: 'groove-t-m2-1',
      faceRole: 'Top',
      axis: 'u',
      position: 6,
      width: 6,
      depth: 8,
    };

    const input = {
      itemNumber: 1,
      partName: 'Side Panel',
      spec: {
        length: 600,
        width: 720,
        thickness: 18,
        materialId: 'm-birch-18',
        grain: 'length',
        edgeBands: {
          front: { materialId: 'm-eb', thickness: 0.8 },
          back: null,
          left: null,
          right: null,
        },
      },
      materialName: 'Birch 18mm',
      bores: [bore],
      grooves: [groove],
      qty: 2,
    };

    await new ExportPanelManufacturingDxfCommand({
      inputs: [input as never],
      suggestedName: 'test-manufacturing.zip',
    }).apply();
  });

  // ── Step 4: Read globalThis.__zilventorManufacturingDxfBytes ─────────────────
  const zipB64 = await page.evaluate((): string | null => {
    const w = window as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array };
    if (!w.__zilventorManufacturingDxfBytes) return null;
    // Transfer bytes to Node via base64
    const bytes = w.__zilventorManufacturingDxfBytes;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  });

  expect(zipB64, '__zilventorManufacturingDxfBytes must be set after command.apply()').not.toBeNull();

  // ── Step 5: Unzip in Node ─────────────────────────────────────────────────────
  const zipBytes = new Uint8Array(Buffer.from(zipB64!, 'base64'));
  const entries = unzipSync(zipBytes);
  const names = Object.keys(entries);

  console.log('[T-M2.1] zip entries:', names);

  // ── Step 6a: 2 entries — per-material DXF + root-level machining.csv sidecar (W7/D2/S1) ──
  expect(names, 'zip must have exactly 2 entries: DXF + machining.csv sidecar').toHaveLength(2);
  expect(names[0], 'entry name must match Birch_18mm/item-1-Side_Panel.dxf').toBe(
    'Birch_18mm/item-1-Side_Panel.dxf',
  );
  expect(names, 'zip must include root-level machining.csv sidecar').toContain('machining.csv');

  const dxf = strFromU8(entries[names[0]!]!);
  console.log('[T-M2.1] DXF length:', dxf.length, 'chars');

  // ── Step 6b: OUTLINE layer ────────────────────────────────────────────────────
  expect(dxf, 'DXF must contain OUTLINE layer reference').toContain('OUTLINE');

  // ── Step 6c: BORES-FRONT-5MM layer (Top-face bore Ø5) ─────────────────────────
  expect(dxf, 'DXF must contain BORES-FRONT-5MM layer (Top-face bore Ø5)').toContain('BORES-FRONT-5MM');

  // ── Step 6d: Exactly 2 DIMENSION entities (L + W) ────────────────────────────
  // Count occurrences of \nDIMENSION\n in the raw DXF text.
  // renderPanelManufacturingDxf always emits exactly 2: horizontal (L) and vertical (W).
  const dimensionMatches = dxf.match(/\nDIMENSION\n/g);
  const dimensionCount = dimensionMatches?.length ?? 0;
  console.log('[T-M2.1] DIMENSION entity count:', dimensionCount);
  expect(
    dimensionCount,
    `DXF must have exactly 2 DIMENSION entities (L + W dims). Got: ${dimensionCount}`,
  ).toBe(2);

  // ── Step 6e: Zero page errors ─────────────────────────────────────────────────
  if (pageErrors.length > 0) {
    console.log('[T-M2.1] PAGE ERRORS:', pageErrors.join('\n'));
  }
  expect(pageErrors, 'No browser page errors during manufacturing DXF export').toHaveLength(0);

  console.log(
    `[T-M2.1] PASSED: entry=${names[0]}, dxfLen=${dxf.length}, ` +
    `OUTLINE=✓, BORES-FRONT-5MM=✓, DIMENSION count=${dimensionCount}`,
  );
});

test('T-M2.1b: manufacturing DXF export — combined mode via dxfExportMode store field', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(`PAGEERROR: ${e.message}`));

  await page.goto('/');
  await waitForKernelReady(page);

  // Stub showSaveFilePicker to capture its call args, then AbortError so
  // apply() falls through and leaves globalThis.__zilventorManufacturingDxfBytes set.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async (
      opts: unknown,
    ) => {
      (window as unknown as { __lastPickerCall: unknown }).__lastPickerCall = opts;
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  await page.evaluate(async () => {
    const { ExportPanelManufacturingDxfCommand } = await import(
      '/src/commands/ExportPanelManufacturingDxfCommand.ts'
    );
    (window as any).__zilventorStore.getState().setDxfExportMode('combined');
    const mode = (window as any).__zilventorStore.getState().dxfExportMode;

    const input = {
      itemNumber: 1,
      partName: 'Side Panel',
      spec: {
        length: 600,
        width: 720,
        thickness: 18,
        materialId: 'm-birch-18',
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      },
      materialName: 'Birch 18mm',
      bores: [],
      grooves: [],
      qty: 1,
    };

    await new ExportPanelManufacturingDxfCommand({
      inputs: [input as never],
      suggestedName: 'test-manufacturing.zip',
      mode,
    }).apply();
  });

  const dxfB64 = await page.evaluate((): string | null => {
    const w = window as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array };
    if (!w.__zilventorManufacturingDxfBytes) return null;
    const bytes = w.__zilventorManufacturingDxfBytes;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  });
  expect(dxfB64, '__zilventorManufacturingDxfBytes must be set after combined apply()').not.toBeNull();

  const bytes = new Uint8Array(Buffer.from(dxfB64!, 'base64'));
  // Combined mode must NOT be a zip (zip files start with the 'PK' signature).
  expect(
    bytes[0] === 0x50 && bytes[1] === 0x4b,
    'combined-mode bytes must not be zip-signed (PK)',
  ).toBe(false);

  const dxf = Buffer.from(bytes).toString('utf8');
  expect(dxf, 'combined DXF must contain OUTLINE layer reference').toContain('OUTLINE');

  const pickerCall = await page.evaluate(() => {
    return (window as unknown as { __lastPickerCall?: { suggestedName?: string } }).__lastPickerCall;
  });
  expect(
    pickerCall?.suggestedName?.endsWith('-combined.dxf'),
    `suggestedName must end with -combined.dxf, got: ${pickerCall?.suggestedName}`,
  ).toBe(true);

  expect(pageErrors, 'No browser page errors during combined-mode export').toHaveLength(0);
});

test('T-P3-W6: manufacturing DXF export — CAM metadata (XDATA) on a bore', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(`PAGEERROR: ${e.message}`));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  await page.evaluate(async () => {
    const { ExportPanelManufacturingDxfCommand } = await import(
      '/src/commands/ExportPanelManufacturingDxfCommand.ts'
    );

    // Bore with CAM fields (toolNumber/speed) set — as ApplyMachiningPresetCommand
    // (a later slice) would set them. Set directly here since this slice (W6) only
    // wires DXF export, not the apply-preset UI.
    const bore = {
      id: 'bore-t-p3-w6',
      face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100,
      v: 80,
      diameter: 5,
      depth: 12,
      role: 'confirmat-face',
      connectorId: 'c0',
      connectorKind: 'confirmat',
      toolNumber: 3,
      speed: 12000,
    };

    const input = {
      itemNumber: 1,
      partName: 'Side Panel',
      spec: {
        length: 600,
        width: 720,
        thickness: 18,
        materialId: 'm-birch-18',
        grain: 'none',
        edgeBands: { front: null, back: null, left: null, right: null },
      },
      materialName: 'Birch 18mm',
      bores: [bore],
      grooves: [],
      qty: 1,
    };

    await new ExportPanelManufacturingDxfCommand({
      inputs: [input as never],
      suggestedName: 'test-cam-metadata.zip',
    }).apply();
  });

  const zipB64 = await page.evaluate((): string | null => {
    const w = window as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array };
    if (!w.__zilventorManufacturingDxfBytes) return null;
    const bytes = w.__zilventorManufacturingDxfBytes;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  });
  expect(zipB64, '__zilventorManufacturingDxfBytes must be set after command.apply()').not.toBeNull();

  const zipBytes = new Uint8Array(Buffer.from(zipB64!, 'base64'));
  const entries = unzipSync(zipBytes);
  const names = Object.keys(entries);
  expect(names, 'zip must have exactly 2 entries: DXF + machining.csv sidecar').toHaveLength(2);
  expect(names, 'zip must include root-level machining.csv sidecar').toContain('machining.csv');

  const dxfName = names.find((n) => n.endsWith('.dxf'));
  expect(dxfName, 'zip must contain a .dxf entry').toBeDefined();
  const dxf = strFromU8(entries[dxfName!]!);

  // XDATA convention (renderPanelManufacturingDxf.ts camXdata): 1001 ZILVENTOR
  // + labeled TOOL_NUMBER (1070 int) / SPEED (1040 real) pairs on the bore's CIRCLE.
  expect(dxf, 'DXF must carry the ZILVENTOR XDATA APPID marker').toContain('1001\nZILVENTOR');
  expect(dxf, 'DXF must carry a TOOL_NUMBER XDATA label').toContain('1000\nTOOL_NUMBER');
  expect(dxf, 'DXF must carry the toolNumber=3 value as XDATA 1070').toContain('1070\n3');
  expect(dxf, 'DXF must carry a SPEED XDATA label').toContain('1000\nSPEED');
  expect(dxf, 'DXF must carry the speed=12000 value as XDATA 1040').toContain('1040\n12000.0000');

  // D2/S1: machining.csv sidecar carries the same CAM metadata as XDATA — closes the e2e loop.
  const csv = strFromU8(entries['machining.csv']!);
  expect(csv, 'machining.csv must carry the header row').toContain(
    'partName,opType,diameter,depth,layer,toolNumber,speed',
  );
  expect(
    csv,
    'machining.csv must carry a row for the test bore with toolNumber=3 and speed=12000',
  ).toMatch(/,3,12000$/m);

  expect(pageErrors, 'No browser page errors during CAM-metadata export').toHaveLength(0);
});

test('T-P9-W3b: combined-mode manufacturing DXF export — machining.csv fires as second sequential download when a bore carries CAM metadata', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(`PAGEERROR: ${e.message}`));

  await page.goto('/');
  await waitForKernelReady(page);

  // Unlike the AbortError stub used elsewhere in this file, this stub actually
  // "succeeds" so ExportPanelManufacturingDxfCommand.apply() sets delivered=true and
  // proceeds to the second, gated machining.csv download (see hasMachiningMetadata()
  // in ExportPanelManufacturingDxfCommand.ts). Every write() call — primary .dxf, then
  // the sidecar CSV via triggerDownload() — is captured into window.__savedFiles in
  // call order, so we can assert both downloads arrived, in order, with real content.
  await page.evaluate(() => {
    const w = window as unknown as {
      __savedFiles: Array<{ name: string; text: string }>;
      showSaveFilePicker: unknown;
    };
    w.__savedFiles = [];
    w.showSaveFilePicker = async (opts: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (data: Uint8Array | Blob) => {
          const text = data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
          w.__savedFiles.push({ name: opts.suggestedName, text });
        },
        close: async () => {},
      }),
    });
  });

  await page.evaluate(async () => {
    const { ExportPanelManufacturingDxfCommand } = await import(
      '/src/commands/ExportPanelManufacturingDxfCommand.ts'
    );

    // Bore with CAM fields set — as ApplyMachiningPresetCommand would set them. This is
    // what gates the second machining.csv download in combined mode.
    const bore = {
      id: 'bore-t-p9-w3b',
      face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100,
      v: 80,
      diameter: 5,
      depth: 12,
      role: 'confirmat-face',
      connectorId: 'c0',
      connectorKind: 'confirmat',
      toolNumber: 7,
      speed: 18000,
    };

    const input = {
      itemNumber: 1,
      partName: 'Side Panel',
      spec: {
        length: 600,
        width: 720,
        thickness: 18,
        materialId: 'm-birch-18',
        grain: 'none',
        edgeBands: { front: null, back: null, left: null, right: null },
      },
      materialName: 'Birch 18mm',
      bores: [bore],
      grooves: [],
      qty: 1,
    };

    await new ExportPanelManufacturingDxfCommand({
      inputs: [input as never],
      suggestedName: 'test-manufacturing.zip',
      mode: 'combined',
    }).apply();
  });

  const savedFiles = await page.evaluate(() => {
    return (window as unknown as { __savedFiles: Array<{ name: string; text: string }> }).__savedFiles;
  });

  expect(savedFiles, 'both downloads must arrive: primary .dxf + secondary machining.csv').toHaveLength(2);

  // First download: unchanged contract — combined single DXF, filename ends -combined.dxf.
  expect(
    savedFiles[0]?.name.endsWith('.dxf'),
    `first download must be the .dxf, got: ${savedFiles[0]?.name}`,
  ).toBe(true);
  expect(savedFiles[0]?.text, 'primary combined DXF must contain OUTLINE layer reference').toContain(
    'OUTLINE',
  );

  // Second download: machining.csv sidecar, fired only because the bore carries CAM metadata.
  expect(savedFiles[1]?.name, 'second download must be machining.csv').toBe('machining.csv');
  expect(savedFiles[1]?.text, 'machining.csv must carry the header row').toContain(
    'partName,opType,diameter,depth,layer,toolNumber,speed',
  );
  expect(
    savedFiles[1]?.text,
    "machining.csv row must carry this bore's toolNumber=7 and speed=18000",
  ).toMatch(/,7,18000$/m);

  expect(pageErrors, 'No browser page errors during combined-mode CSV second-download export').toHaveLength(0);
});
