import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

vi.mock('../../../import/extractStepFromZip', () => ({
  extractStepFromZip: vi.fn(),
}));
import { extractStepFromZip } from '../../../import/extractStepFromZip';

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
    // Provide extractStepSolids returning 1 solid so the code routes through
    // the single-body path (importStepIntoNewPart).
    useAppStore.setState((s) => ({
      ...s,
      kernel: {
        extractStepSolids: vi.fn(async () => [
          { brepBlobId: 'blob-solo', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
        ]),
      } as any,
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
    // Provide extractStepSolids returning 1 solid so part-mode routes through
    // the single-body path (importStepIntoNewPart) for the regression guard test.
    useAppStore.setState((s) => ({
      ...s,
      kernel: {
        extractStepSolids: vi.fn(async () => [
          { brepBlobId: 'blob-solo', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
        ]),
      } as any,
    }));
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

describe('handleOpen — ZIP branch', () => {
  const FAKE_STEP_BYTES = new Uint8Array([1, 2, 3, 4]);

  function makeFakeZipHandle(name: string, zipBytes: Uint8Array) {
    const fakeFile = { name, arrayBuffer: async () => zipBytes.buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    useAppStore.getState().setActiveDocument(null);
    vi.mocked(ImportStepAsComponentCommand).mockClear();
    vi.mocked(importStepIntoNewPart).mockClear();
    vi.mocked(extractStepFromZip).mockClear();
  });

  it('ZIP + assembly active + zip contains STEP → dispatches ImportStepAsComponentCommand', async () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
      components: [], constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });

    vi.mocked(extractStepFromZip).mockReturnValue({
      fileName: 'Cadeira_preta.stp',
      stepBytes: FAKE_STEP_BYTES.buffer,
    });

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
      makeFakeZipHandle('Cadeira_preta.zip', new Uint8Array([80, 75, 3, 4])),
    ]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(vi.mocked(ImportStepAsComponentCommand)).toHaveBeenCalledOnce();
    });

    const args = vi.mocked(ImportStepAsComponentCommand).mock.calls[0]?.[0];
    expect(args?.fileName).toBe('Cadeira_preta.stp');
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  });

  it('ZIP + part active + zip contains STEP → dispatches importStepIntoNewPart', async () => {
    const fakePart = {
      id: 'p1', name: 'ZipPart', units: 'mm' as const,
      parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
    };
    useAppStore.getState().setActivePart(fakePart);
    vi.mocked(importStepIntoNewPart).mockResolvedValue({ partId: 'p1', part: fakePart });

    vi.mocked(extractStepFromZip).mockReturnValue({
      fileName: 'model.step',
      stepBytes: FAKE_STEP_BYTES.buffer,
    });

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
      makeFakeZipHandle('model.zip', new Uint8Array([80, 75, 3, 4])),
    ]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(vi.mocked(importStepIntoNewPart)).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
  });

  it('ZIP without STEP → shows error dialog, dispatches nothing', async () => {
    vi.mocked(extractStepFromZip).mockReturnValue(null);

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
      makeFakeZipHandle('textures-only.zip', new Uint8Array([80, 75, 3, 4])),
    ]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('alertdialog').textContent).toMatch(/no step\/stp file found/i);
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  });
});

describe('handleOpen — STEP part-mode multi-body branch', () => {
  function makeFakeStepHandle(name: string) {
    const fakeFile = { name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    vi.mocked(importStepIntoNewPart).mockClear();
    vi.mocked(ImportStepAsComponentCommand).mockClear();
  });

  it('multi-body STEP in part-mode registers only the first sub-solid and emits setStatus', async () => {
    const registerPart = vi.fn(async () => {});
    const extractStepSolids = vi.fn(async () => [
      { brepBlobId: 'b1', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
      { brepBlobId: 'b2', boundingBox: [20, 0, 0, 30, 10, 10] as [number, number, number, number, number, number] },
      { brepBlobId: 'b3', boundingBox: [40, 0, 0, 50, 10, 10] as [number, number, number, number, number, number] },
    ]);

    useAppStore.setState((s) => ({
      ...s,
      kernel: { extractStepSolids, registerPart } as any,
    }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('gizmo.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    await waitFor(() => {
      expect(registerPart).toHaveBeenCalledTimes(1);
    });

    expect(extractStepSolids).toHaveBeenCalledTimes(1);
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
    const statusMsg = useAppStore.getState().statusMessage;
    expect(statusMsg).toContain('first body of 3');
    expect(statusMsg).toContain('gizmo.step');
  });
});

describe('Import from Inventor button — directory picker gating', () => {
  afterEach(() => {
    delete (window as any).showDirectoryPicker;
  });

  it('is disabled and has a tooltip when showDirectoryPicker is absent', () => {
    delete (window as any).showDirectoryPicker;
    render(<FileTab />);
    const btn = screen.getByRole('button', { name: /import from inventor/i });
    expect(btn).toBeDisabled();
    expect(btn.title).toMatch(/chrome|edge|brave|arc/i);
  });

  it('is enabled when showDirectoryPicker is present', () => {
    (window as any).showDirectoryPicker = vi.fn();
    render(<FileTab />);
    const btn = screen.getByRole('button', { name: /import from inventor/i });
    expect(btn).not.toBeDisabled();
    expect(btn.title).toBeFalsy();
  });
});
