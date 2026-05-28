import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileTab from '../FileTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

vi.mock('../../../commands/ImportStepAsComponentCommand', () => ({
  ImportStepAsComponentCommand: vi.fn().mockImplementation(() => ({
    name: 'ImportStepAsComponent',
    apply: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
  })),
}));
import { ImportStepAsComponentCommand } from '../../../commands/ImportStepAsComponentCommand';

vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      delete: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    }),
    forRoot: vi.fn(),
  },
}));

// Mock importStepIntoNewPart so the STEP branch doesn't hit the real kernel
vi.mock('../../../import/importStepIntoNewPart', () => ({
  importStepIntoNewPart: vi.fn(),
}));
import { importStepIntoNewPart } from '../../../import/importStepIntoNewPart';

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
    const asm: AssemblyDocument = { id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };

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
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });

    const fakeWritable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    const fakeHandle = { kind: 'file', createWritable: vi.fn().mockResolvedValue(fakeWritable) } as unknown as FileSystemFileHandle;
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

describe('handleOpen — STEP branch', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.setState((s) => ({
      ...s,
      kernel: {} as any,
    }));
  });

  it('routes a .step file through importStepIntoNewPart and activates the part', async () => {
    const stepBytes = new Uint8Array([1, 2, 3]);
    const fakeFile = new File([stepBytes], 'Knob.step', { type: 'application/step' });
    // jsdom's File may lack arrayBuffer(); duck-type to ensure it's present.
    Object.defineProperty(fakeFile, 'arrayBuffer', { value: async () => stepBytes.buffer });
    const fakeHandle = { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
    (window as unknown as { showOpenFilePicker: () => Promise<[FileSystemFileHandle]> })
      .showOpenFilePicker = async () => [fakeHandle];

    const fakePart = {
      id: 'step-part-1',
      name: 'Knob',
      units: 'mm' as const,
      parameters: {},
      featureTree: [],
      properties: {},
      materials: [],
      hardware: [],
    };
    vi.mocked(importStepIntoNewPart).mockResolvedValue({ partId: 'step-part-1', part: fakePart });

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(useAppStore.getState().activePart?.name).toBe('Knob');
    });

    expect(vi.mocked(importStepIntoNewPart)).toHaveBeenCalledOnce();
    expect(useAppStore.getState().statusMessage).toBe('Imported');
  });
});

describe('handleOpen — STEP branch dispatches by active-document kind', () => {
  function makeFakeStepHandle(name: string) {
    const fakeFile = { name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    vi.mocked(ImportStepAsComponentCommand).mockClear();
    vi.mocked(importStepIntoNewPart).mockClear();
  });

  it('STEP + assembly active → dispatches ImportStepAsComponentCommand, NOT importStepIntoNewPart', async () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
      components: [], constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('bolt.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(vi.mocked(ImportStepAsComponentCommand)).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  });

  it('STEP + part active → dispatches importStepIntoNewPart (regression guard)', async () => {
    const fakePart = {
      id: 'p1', name: 'MyPart', units: 'mm' as const,
      parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
    };
    useAppStore.getState().setActivePart(fakePart);
    vi.mocked(importStepIntoNewPart).mockResolvedValue({ partId: 'p1', part: fakePart });

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('hinge.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(vi.mocked(importStepIntoNewPart)).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
  });
});
