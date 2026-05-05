import { describe, it, expect, vi } from 'vitest';
import { ExportDrawingPngCommand } from '../ExportDrawingPngCommand';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingPngForSheet', () => ({
  renderDrawingPngForSheet: vi.fn().mockResolvedValue(
    new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
  ),
}));

import { triggerDownload } from '../../nesting/triggerDownload';

describe('ExportDrawingPngCommand', () => {
  it('calls triggerDownload with a Blob of type image/png', async () => {
    const drawing = makeFixtureDrawing();
    const cmd = new ExportDrawingPngCommand({
      drawing,
      sheetId: drawing.sheets[0]!.id,
      source: makeFixturePart(),
    });
    await cmd.apply();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob] = (triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0] as [Blob];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});
