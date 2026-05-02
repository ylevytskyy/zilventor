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
  packAssembly: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));
vi.mock('@zilventor/kernel/src/storage/FileSystemAccess', () => ({
  writeToHandle: vi.fn().mockResolvedValue(undefined),
  readFromHandle: vi.fn(),
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
    const asm: AssemblyDocument = { id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, materials: [] };

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

  it('Save As writes a .ziasm archive when active document is an assembly', async () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
      components: [{
        id: 'C1', partPath: 'parts/leg.zipt',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
      }],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, colorOverrides: {},
      materials: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });

    const fakeHandle = { kind: 'file' } as unknown as FileSystemFileHandle;
    (window as any).showSaveFilePicker = vi.fn().mockResolvedValue(fakeHandle);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /save as/i }));

    await waitFor(() => {
      expect((window as any).showSaveFilePicker).toHaveBeenCalled();
    });
    const args = (window as any).showSaveFilePicker.mock.calls[0]![0];
    expect(args.suggestedName).toBe('cabinet.ziasm');
    expect(args.types[0].accept['application/zilinventor-assembly']).toContain('.ziasm');
  });
});
