import { describe, it, expect, vi } from 'vitest';
import { ExportDrawingSvgCommand } from '../ExportDrawingSvgCommand';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));

import { triggerDownload } from '../../nesting/triggerDownload';

describe('ExportDrawingSvgCommand', () => {
  it('calls triggerDownload with a non-empty Blob of type image/svg+xml', async () => {
    const drawing = makeFixtureDrawing();
    const cmd = new ExportDrawingSvgCommand({
      drawing,
      sheetId: drawing.sheets[0]!.id,
      source: makeFixturePart(),
    });
    await cmd.apply();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob] = (triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0] as [Blob];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/svg+xml');
    expect(blob.size).toBeGreaterThan(0);
  });
});
