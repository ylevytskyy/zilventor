// @vitest-environment node
/**
 * Unit tests for the FileTab handleOpen drawing branch.
 *
 * We cannot render FileTab in jsdom (it calls showOpenFilePicker which requires
 * a real browser). Instead we test the branch logic by importing the helpers
 * directly and verifying the integration contract.
 *
 * Strategy: mock unpackDrawing + activateDrawingDocument, then drive handleOpen
 * via an extracted testable function (or spy on the imports).
 */
import { describe, it, expect } from 'vitest';
import { packDrawing } from '../../../storage/DrawingPacker';
import type { DrawingDocument } from '@zilventor/shared';

// We test the serializer contract end-to-end and assert that unpackDrawing
// correctly returns a DrawingDocument — this validates the FileTab will receive
// the right value from unpackDrawing(bytes) when the branch runs.
const baseDoc: DrawingDocument = {
  id: 'drw-test',
  name: 'Test Drawing',
  units: 'mm',
  source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 'sh1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 'sh1',
};

describe('FileTab handleOpen drawing branch integration', () => {
  it('packDrawing → unpackDrawing round-trip returns a valid DrawingDocument', async () => {
    // This verifies the exact byte flow FileTab uses: read file bytes → unpackDrawing
    const { unpackDrawing } = await import('../../../storage/DrawingPacker');
    const bytes = await packDrawing(baseDoc);
    const recovered = await unpackDrawing(bytes);
    expect(recovered.id).toBe('drw-test');
    expect(recovered.source.partPath).toBe('parts/test.zipt');
    expect(recovered.source.sourceKind).toBe('part');
    expect(recovered.sheets).toHaveLength(1);
  });

  it('unpackDrawing throws on wrong-kind bytes (bad .zipt opened as .zidw)', async () => {
    const { unpackDrawing } = await import('../../../storage/DrawingPacker');
    const { writeTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
    const wrongKind = await writeTarGz([
      {
        name: 'manifest.json',
        data: new TextEncoder().encode(
          JSON.stringify({ formatVersion: 19, kind: 'part', document: {} })
        ),
      },
    ]);
    await expect(unpackDrawing(wrongKind)).rejects.toThrow(/kind/i);
  });

  it('the .zidw accept type is declared in FileTab showOpenFilePicker types', async () => {
    // Read the source to assert the accept type declaration
    // (structural test — verifies the literal string is present)
    const fs = await import('fs/promises');
    const src = await fs.readFile(
      new URL('../FileTab.tsx', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).toContain('.zidw');
    expect(src).toContain('application/zilinventor-drawing');
  });
});

// ---------------------------------------------------------------------------
// Save As — drawing branch
// ---------------------------------------------------------------------------

describe('FileTab handleSaveAs drawing branch', () => {
  it('FileTab imports packDrawing and wires it into handleSaveAs with .zidw extension', async () => {
    // Structural assertion: FileTab.tsx source must contain the exact call
    // "await packDrawing(" — this literal only appears in the Save As drawing
    // branch (handleOpen uses unpackDrawing, not packDrawing).
    //
    // When the drawing branch is a TODO no-op, "await packDrawing(" is absent
    // from the source → the expect below fails (RED). After implementation it
    // will be present (GREEN).
    const fs = await import('fs/promises');
    const src = await fs.readFile(
      new URL('../FileTab.tsx', import.meta.url).pathname,
      'utf-8'
    );
    // "packDrawing" import must be present (added alongside packAssembly-style import)
    expect(src).toContain('packDrawing');
    // The actual async call must be present in handleSaveAs
    expect(src).toContain('await packDrawing(');
    // The save picker for drawings must suggest a .zidw extension via template literal
    expect(src).toContain('.zidw`');
    // Must use the drawing accept MIME type in the save picker
    expect(src).toContain('application/zilinventor-drawing');
  });

  it('packDrawing output can be round-tripped through unpackDrawing (validates bytes written by Save As)', async () => {
    // End-to-end contract test: validates what handleSaveAs writes to disk.
    // This proves packDrawing produces bytes that unpackDrawing correctly recovers,
    // so the file the user saves can be reopened.
    const { packDrawing, unpackDrawing } = await import('../../../storage/DrawingPacker');
    const doc: DrawingDocument = baseDoc;
    const bytes = await packDrawing(doc);
    const recovered = await unpackDrawing(bytes);
    expect(recovered.id).toBe('drw-test');
    expect(recovered.name).toBe('Test Drawing');
    expect(recovered.sheets).toHaveLength(1);
  });
});
