import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasFsa, hasDirectoryPicker, pickFile, saveBlob } from '../fsaFallback';
import type { FilePickerType } from '../fsaFallback';

const TYPES: FilePickerType[] = [
  { description: 'STEP file', accept: { 'application/step': ['.step', '.stp'] } },
];

describe('hasFsa()', () => {
  it('returns true when window.showOpenFilePicker is a function', () => {
    (window as any).showOpenFilePicker = vi.fn();
    expect(hasFsa()).toBe(true);
    delete (window as any).showOpenFilePicker;
  });

  it('returns false when showOpenFilePicker is not defined', () => {
    const orig = (window as any).showOpenFilePicker;
    delete (window as any).showOpenFilePicker;
    expect(hasFsa()).toBe(false);
    if (orig !== undefined) (window as any).showOpenFilePicker = orig;
  });
});

describe('hasDirectoryPicker()', () => {
  it('returns true when window.showDirectoryPicker is a function', () => {
    (window as any).showDirectoryPicker = vi.fn();
    expect(hasDirectoryPicker()).toBe(true);
    delete (window as any).showDirectoryPicker;
  });

  it('returns false when showDirectoryPicker is not defined', () => {
    const orig = (window as any).showDirectoryPicker;
    delete (window as any).showDirectoryPicker;
    expect(hasDirectoryPicker()).toBe(false);
    if (orig !== undefined) (window as any).showDirectoryPicker = orig;
  });
});

describe('pickFile()', () => {
  beforeEach(() => {
    delete (window as any).showOpenFilePicker;
  });
  afterEach(() => {
    delete (window as any).showOpenFilePicker;
  });

  it('uses FSA when available and returns the resolved File', async () => {
    const fakeFile = new File(['hello'], 'part.step', { type: 'application/step' });
    const fakeHandle = { getFile: vi.fn().mockResolvedValue(fakeFile) };
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([fakeHandle]);

    const result = await pickFile(TYPES);
    expect(result).toBe(fakeFile);
    expect((window as any).showOpenFilePicker).toHaveBeenCalledOnce();
  });

  it('returns null on AbortError from FSA path', async () => {
    const err = Object.assign(new Error('User cancelled'), { name: 'AbortError' });
    (window as any).showOpenFilePicker = vi.fn().mockRejectedValue(err);

    const result = await pickFile(TYPES);
    expect(result).toBeNull();
  });

  it('falls back to <input type="file"> when FSA is missing; resolves with input.files[0]', async () => {
    // FSA not present — delete just in case
    delete (window as any).showOpenFilePicker;

    const fakeFile = new File(['bytes'], 'cube.step');
    const promise = pickFile(TYPES);

    // Wait a tick for the <input> to be appended and clicked
    await new Promise((r) => setTimeout(r, 0));

    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    // Simulate a file selection by defining files property
    Object.defineProperty(input, 'files', {
      value: Object.assign([fakeFile], { item: (i: number) => [fakeFile][i] }),
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    const result = await promise;
    expect(result).toBe(fakeFile);
    // Input should be removed from DOM after resolve
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('saveBlob()', () => {
  beforeEach(() => {
    delete (window as any).showSaveFilePicker;
  });
  afterEach(() => {
    delete (window as any).showSaveFilePicker;
    // clean up any stray anchor tags
    document.querySelectorAll('a[download]').forEach((el) => el.remove());
  });

  it('uses showSaveFilePicker when available and calls createWritable().write().close()', async () => {
    const fakeClose = vi.fn().mockResolvedValue(undefined);
    const fakeWrite = vi.fn().mockResolvedValue(undefined);
    const fakeWritable = { write: fakeWrite, close: fakeClose };
    const fakeHandle = { createWritable: vi.fn().mockResolvedValue(fakeWritable) };
    (window as any).showSaveFilePicker = vi.fn().mockResolvedValue(fakeHandle);

    const blob = new Blob(['data'], { type: 'application/octet-stream' });
    const result = await saveBlob(blob, 'part.zipt', TYPES);

    expect(result).toBe(true);
    expect((window as any).showSaveFilePicker).toHaveBeenCalledOnce();
    expect(fakeHandle.createWritable).toHaveBeenCalledOnce();
    expect(fakeWrite).toHaveBeenCalledWith(blob);
    expect(fakeClose).toHaveBeenCalledOnce();
  });

  it('falls back to anchor-download when FSA is missing', async () => {
    delete (window as any).showSaveFilePicker;

    // jsdom does not implement URL.createObjectURL — stub it
    const fakeUrl = 'blob:http://localhost/fake-uuid';
    const createObjectURL = vi.fn().mockReturnValue(fakeUrl);
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    const createElementOrig = document.createElement.bind(document);
    let capturedAnchor: HTMLAnchorElement | null = null;
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElementOrig(tag);
      if (tag === 'a') {
        capturedAnchor = el as HTMLAnchorElement;
        vi.spyOn(capturedAnchor, 'click').mockImplementation(() => {});
      }
      return el;
    });

    const blob = new Blob(['data']);
    const result = await saveBlob(blob, 'part.zipt', TYPES);

    expect(result).toBe(true);
    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor!.download).toBe('part.zipt');
    expect(capturedAnchor!.href).toBe(fakeUrl);
    expect(appendSpy).toHaveBeenCalledWith(capturedAnchor);
    expect(removeSpy).toHaveBeenCalledWith(capturedAnchor);
    expect(revokeObjectURL).toHaveBeenCalledWith(fakeUrl);

    appendSpy.mockRestore();
    removeSpy.mockRestore();
    createSpy.mockRestore();
  });
});
