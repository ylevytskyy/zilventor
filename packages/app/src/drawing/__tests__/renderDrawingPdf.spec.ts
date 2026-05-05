import { describe, it, expect } from 'vitest';
import { renderDrawingPdf } from '../renderDrawingPdf';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('renderDrawingPdf', () => {
  it('returns a Blob with type application/pdf', async () => {
    const drawing = makeFixtureDrawing();
    const source = makeFixturePart();
    const blob = renderDrawingPdf(drawing, source);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('has non-zero size', async () => {
    const blob = renderDrawingPdf(makeFixtureDrawing(), makeFixturePart());
    expect(blob.size).toBeGreaterThan(0);
  });

  it('starts with PDF magic bytes %PDF-', async () => {
    const blob = renderDrawingPdf(makeFixtureDrawing(), makeFixturePart());
    const bytes = await readBlobAsUint8Array(blob);
    // '%PDF-' = [37, 80, 68, 70, 45]
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);
  });

  it('produces one jsPDF page per sheet', async () => {
    const drawing = makeFixtureDrawing({ sheetCount: 3 });
    const blob = renderDrawingPdf(drawing, makeFixturePart());
    const bytes = await readBlobAsUint8Array(blob);
    const text = new TextDecoder('latin1').decode(bytes);
    const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageMatches.length).toBe(3);
  });
});
