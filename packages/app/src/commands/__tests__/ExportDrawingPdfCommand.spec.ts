import { describe, it, expect, vi } from 'vitest';
import { ExportDrawingPdfCommand } from '../ExportDrawingPdfCommand';
import { makeFixtureDrawing, makeFixturePart } from '../../__tests__/fixtures/drawingFixtures';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));

import { triggerDownload } from '../../nesting/triggerDownload';

describe('ExportDrawingPdfCommand', () => {
  it('calls triggerDownload with a non-empty Blob of type application/pdf', async () => {
    const cmd = new ExportDrawingPdfCommand({
      drawing: makeFixtureDrawing(),
      source: makeFixturePart(),
    });
    await cmd.apply();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob] = (triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0] as [Blob];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});
