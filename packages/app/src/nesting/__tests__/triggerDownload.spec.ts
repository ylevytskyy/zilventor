import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { triggerDownload } from '../triggerDownload';

// JSDOM does not implement URL.createObjectURL; stub it.
beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:fake';
    URL.revokeObjectURL = () => undefined;
  }
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).showSaveFilePicker;
});

describe('triggerDownload', () => {
  it('uses showSaveFilePicker when available and writes the blob', async () => {
    const writes: Blob[] = [];
    const closes: number[] = [];
    (globalThis as Record<string, unknown>).showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (b: Blob) => { writes.push(b); },
        close: async () => { closes.push(1); },
      }),
    });
    const blob = new Blob(['x'], { type: 'text/plain' });
    await triggerDownload(blob, { suggestedName: 't.txt', mimeType: 'text/plain', extension: 'txt', description: 'Text' });
    expect(writes).toHaveLength(1);
    expect(closes).toHaveLength(1);
  });

  it('falls back to a-tag when showSaveFilePicker is undefined', async () => {
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
    let clicked = 0;
    const origCreate = document.createElement;
    document.createElement = ((tag: string) => {
      const el = origCreate.call(document, tag) as HTMLAnchorElement;
      if (tag === 'a') {
        const origClick = el.click.bind(el);
        el.click = () => { clicked++; origClick(); };
      }
      return el;
    }) as never;
    const blob = new Blob(['x'], { type: 'text/plain' });
    await triggerDownload(blob, { suggestedName: 't.txt', mimeType: 'text/plain', extension: 'txt', description: 'Text' });
    expect(clicked).toBe(1);
    document.createElement = origCreate;
  });

  it('AbortError from showSaveFilePicker → no fallback, returns silently', async () => {
    (globalThis as Record<string, unknown>).showSaveFilePicker = async () => {
      const e = new Error('cancelled'); (e as { name?: string }).name = 'AbortError'; throw e;
    };
    await expect(triggerDownload(new Blob(['x']), {
      suggestedName: 't.txt', mimeType: 'text/plain', extension: 'txt', description: 'Text',
    })).resolves.toBeUndefined();
  });
});
