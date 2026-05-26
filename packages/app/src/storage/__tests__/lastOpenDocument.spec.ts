import { describe, it, expect, beforeEach } from 'vitest';
import { setLastOpenDrawing, getLastOpenDrawing, clearLastOpen } from '../lastOpenDocument';

// test-setup.ts installs a working in-memory localStorage shim for Node 25.
// No additional setup needed.

describe('lastOpenDocument', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing stored', () => {
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('set → get round-trips the opfsPath', () => {
    setLastOpenDrawing('drawings/abc-123.zidw');
    const result = getLastOpenDrawing();
    expect(result).toEqual({ kind: 'drawing', opfsPath: 'drawings/abc-123.zidw' });
  });

  it('clearLastOpen removes the stored entry', () => {
    setLastOpenDrawing('drawings/abc-123.zidw');
    clearLastOpen();
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('returns null on corrupt JSON (does not throw)', () => {
    localStorage.setItem('zilventor:lastOpenDocument', '{bad json');
    expect(() => getLastOpenDrawing()).not.toThrow();
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('returns null when JSON is valid but wrong shape', () => {
    localStorage.setItem('zilventor:lastOpenDocument', JSON.stringify({ kind: 'part', id: 'x' }));
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('second setLastOpenDrawing overwrites previous value', () => {
    setLastOpenDrawing('drawings/old.zidw');
    setLastOpenDrawing('drawings/new.zidw');
    expect(getLastOpenDrawing()).toEqual({ kind: 'drawing', opfsPath: 'drawings/new.zidw' });
  });
});
