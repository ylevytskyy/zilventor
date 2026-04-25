import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileTab from '../FileTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

// Mock kernel storage utilities so jsdom tests don't depend on tar-stream/streamx
vi.mock('@zilventor/kernel/src/storage/tarGzipUtil', () => ({
  readTarGz: vi.fn(),
}));
vi.mock('@zilventor/kernel/src/storage/AssemblyPacker', () => ({
  unpackAssembly: vi.fn(),
}));

import { readTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';

describe('FileTab', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('File → New Assembly creates an empty assembly as activeDocument', () => {
    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /new assembly/i }));
    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');
    expect(useAppStore.getState().activeAssembly?.components).toEqual([]);
    expect(useAppStore.getState().activeAssembly?.name).toBe('untitled-assembly');
  });

  it('Open accepts .ziasm and routes through setActiveDocument(assembly)', async () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, components: [] };

    // Stub readTarGz to return pre-parsed entries (avoids tar-stream/streamx in jsdom)
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify({ formatVersion: 7, kind: 'assembly', document: asm }),
    );
    vi.mocked(readTarGz).mockResolvedValue([
      { name: 'manifest.json', data: manifestBytes },
    ]);
    // Stub unpackAssembly to return the doc directly
    vi.mocked(unpackAssembly).mockResolvedValue(asm);

    const fakeHandle = {
      getFile: async () => ({
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    };
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([fakeHandle]);

    useAppStore.setState((s) => ({
      ...s,
      kernel: {} as any,
    }));

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');
    });
    expect(useAppStore.getState().activeAssembly?.name).toBe('cabinet');
  });
});
