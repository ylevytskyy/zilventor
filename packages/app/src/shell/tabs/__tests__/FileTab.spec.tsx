import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileTab, { STEP_MAX_BYTES } from '../FileTab';
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
  unpackAssemblyWithTextures: vi.fn().mockResolvedValue({ doc: undefined, textures: {} }),
  packAssembly: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));
vi.mock('@zilventor/kernel/src/storage/FileSystemAccess', () => ({
  writeToHandle: vi.fn().mockResolvedValue(undefined),
  readFromHandle: vi.fn(),
}));

import { readTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackAssembly, unpackAssemblyWithTextures } from '@zilventor/kernel/src/storage/AssemblyPacker';

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
    // Stub both unpack variants: production code calls unpackAssemblyWithTextures.
    vi.mocked(unpackAssembly).mockResolvedValue(asm);
    vi.mocked(unpackAssemblyWithTextures).mockResolvedValue({ doc: asm, textures: {} });

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
    vi.mocked(importStepIntoNewPart).mockClear();
  });

  it('single-body .step in part-mode: importStep called once, part activated', async () => {
    const stepBytes = new Uint8Array([1, 2, 3]);
    const fakeFile = new File([stepBytes], 'Knob.step', { type: 'application/step' });
    Object.defineProperty(fakeFile, 'arrayBuffer', { value: async () => stepBytes.buffer });
    const fakeHandle = { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
    (window as unknown as { showOpenFilePicker: () => Promise<[FileSystemFileHandle]> })
      .showOpenFilePicker = async () => [fakeHandle];

    const importStep = vi.fn(async () => ({
      brepBlobId: 'blob-solo',
      triangleCount: 12,
      boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
      faceCount: 6,
      solidCount: 1,
    }));
    const registerPart = vi.fn(async () => {});

    useAppStore.setState((s) => ({
      ...s,
      kernel: { importStep, registerPart } as any,
    }));

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(registerPart).toHaveBeenCalledOnce();
    });

    // Single parse: importStep called once via importStep+splitImportedShape pipeline.
    expect(importStep).toHaveBeenCalledOnce();
    // Part is activated with the correct name.
    expect(useAppStore.getState().activePart?.name).toBe('Knob');
    expect(useAppStore.getState().statusMessage).toBe('Imported');
    // importStepIntoNewPart helper is no longer used in this path.
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  });
});

describe('handleOpen — STEP branch dispatches by active-document kind', () => {
  function makeFakeStepHandle(name: string) {
    const fakeFile = { name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
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

    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('bolt.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(vi.mocked(ImportStepAsComponentCommand)).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  });

  it('STEP + part active → uses importStep (single parse, regression guard)', async () => {
    const fakePart = {
      id: 'p1', name: 'MyPart', units: 'mm' as const,
      parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
    };
    useAppStore.getState().setActivePart(fakePart);

    const importStep = vi.fn(async () => ({
      brepBlobId: 'blob-solo',
      triangleCount: 12,
      boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
      faceCount: 6,
      solidCount: 1,
    }));
    const registerPart = vi.fn(async () => {});
    useAppStore.setState((s) => ({
      ...s,
      kernel: { importStep, registerPart } as any,
    }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('hinge.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(registerPart).toHaveBeenCalledOnce();
    });
    // Single parse via importStep; importStepIntoNewPart no longer used.
    expect(importStep).toHaveBeenCalledOnce();
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
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

describe('handleOpen — STEP part-mode always imports the whole compound', () => {
  function makeFakeStepHandle(name: string) {
    const fakeFile = { name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    vi.mocked(importStepIntoNewPart).mockClear();
    vi.mocked(ImportStepAsComponentCommand).mockClear();
  });

  it('multi-body STEP in part-mode imports the whole compound (importStep called once, no _1 suffix)', async () => {
    const registerPart = vi.fn(async () => {});
    const importStep = vi.fn(async () => ({
      brepBlobId: 'blob-compound',
      triangleCount: 36,
      boundingBox: [0, 0, 0, 50, 10, 10] as [number, number, number, number, number, number],
      faceCount: 18,
      solidCount: 3,
    }));

    useAppStore.setState((s) => ({
      ...s,
      kernel: { importStep, registerPart } as any,
    }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('gizmo.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    await waitFor(() => {
      expect(registerPart).toHaveBeenCalledTimes(1);
    });

    // Whole-compound path: importStep called once via importStep+splitImportedShape pipeline.
    expect(importStep).toHaveBeenCalledTimes(1);
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
    // Name has no _1 suffix; status is plain 'Imported'.
    expect(useAppStore.getState().activePart?.name).toBe('gizmo');
    expect(useAppStore.getState().statusMessage).toBe('Imported');
  });

  it('single-body STEP in part-mode imports the whole compound', async () => {
    const registerPart = vi.fn(async () => {});
    const importStep = vi.fn(async () => ({
      brepBlobId: 'blob-single',
      triangleCount: 12,
      boundingBox: [-50, -10, -10, 50, 10, 10] as [number, number, number, number, number, number],
      faceCount: 6,
      solidCount: 1,
    }));

    useAppStore.setState((s) => ({
      ...s,
      kernel: { importStep, registerPart } as any,
    }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('Predator.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => { expect(registerPart).toHaveBeenCalledOnce(); });

    expect(importStep).toHaveBeenCalledOnce();
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
    // Bare basename, no _1 suffix; status is plain 'Imported'.
    expect(useAppStore.getState().activePart?.name).toBe('Predator');
    expect(useAppStore.getState().statusMessage).toBe('Imported');
  });
});

describe('handleOpen — SolidWorks native branch', () => {
  function makeFakeHandle(name: string) {
    const fakeFile = { name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    vi.mocked(importStepIntoNewPart).mockClear();
    vi.mocked(ImportStepAsComponentCommand).mockClear();
  });

  it('.sldprt → shows guidance dialog, dispatches nothing', async () => {
    const importStep = vi.fn();
    useAppStore.setState((s) => ({ ...s, kernel: { importStep } as any }));
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeHandle('bracket.SLDPRT')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('alertdialog').textContent).toMatch(/STEP/);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/can't be opened directly/i);
    expect(importStep).not.toHaveBeenCalled();
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
  });

  it('.sldasm → shows guidance dialog', async () => {
    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeHandle('chassis.sldasm')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Save As/i);
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

describe('handleOpen — STEP import progress ticker (integration)', () => {
  /**
   * This test verifies that the FileTab wires the ticker correctly:
   * importStep status shows "Importing" before the kernel call resolves,
   * and switches to "Imported" once done.
   *
   * We use real timers here (not fake timers) to avoid interactions with
   * waitFor's internal polling. The ticker unit tests in importTicker.spec.ts
   * use fake timers and cover the elapsed-time ticking behavior in detail.
   */
  function makeFakeStepHandle(name: string) {
    const fakeFile = { name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setStatus('');
  });

  afterEach(() => {
    vi.mocked(importStepIntoNewPart).mockClear();
    vi.mocked(ImportStepAsComponentCommand).mockClear();
  });

  it('sets "Importing STEP…" status before kernel.importStep resolves, then "Imported" after', async () => {
    let resolveImport!: (value: {
      brepBlobId: string; triangleCount: number;
      boundingBox: [number, number, number, number, number, number];
      faceCount: number; solidCount: number;
    }) => void;

    const slowImportStep = vi.fn(
      () =>
        new Promise<{
          brepBlobId: string; triangleCount: number;
          boundingBox: [number, number, number, number, number, number];
          faceCount: number; solidCount: number;
        }>((res) => { resolveImport = res; }),
    );
    const registerPart = vi.fn(async () => {});

    useAppStore.setState((s) => ({
      ...s,
      kernel: { importStep: slowImportStep, registerPart } as any,
    }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('BigAssembly.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    // Wait until the status changes to "Importing…" (before importStep resolves)
    await waitFor(() => {
      expect(useAppStore.getState().statusMessage).toMatch(/importing/i);
    });

    // Resolve the slow import
    resolveImport({
      brepBlobId: 'blob-big',
      triangleCount: 100,
      boundingBox: [0, 0, 0, 100, 100, 100],
      faceCount: 50,
      solidCount: 1,
    });

    // Wait for import to complete and final status to be set
    await waitFor(() => expect(registerPart).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(useAppStore.getState().statusMessage).toBe('Imported');
    });
  });
});

describe('handleOpen — STEP byte-size guard (A4)', () => {
  function makeFakeStepHandle(name: string, sizeBytes: number) {
    // File.size is read-only; use Object.defineProperty to stub it.
    const fakeFile = { name, size: sizeBytes, arrayBuffer: async () => new Uint8Array(3).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    vi.mocked(importStepIntoNewPart).mockClear();
    vi.mocked(ImportStepAsComponentCommand).mockClear();
  });

  it('rejects a STEP file larger than STEP_MAX_BYTES with an error dialog', async () => {
    const oversizeBytes = STEP_MAX_BYTES + 1;

    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
      makeFakeStepHandle('huge.step', oversizeBytes),
    ]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    // Error dialog should mention the size limit.
    expect(screen.getByRole('alertdialog').textContent).toMatch(/50\s*MB/i);
    // No kernel call made.
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
  });

  it('allows a STEP file exactly at STEP_MAX_BYTES (boundary: passes through)', async () => {
    const importStep = vi.fn(async () => ({
      brepBlobId: 'blob-ok',
      triangleCount: 12,
      boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
      faceCount: 6,
      solidCount: 1,
    }));
    const registerPart = vi.fn(async () => {});

    useAppStore.setState((s) => ({ ...s, kernel: { importStep, registerPart } as any }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
      makeFakeStepHandle('exactly-max.step', STEP_MAX_BYTES),
    ]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    // Import should proceed without an error dialog.
    await waitFor(() => expect(importStep).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('STEP_MAX_BYTES constant is 50 MB', () => {
    expect(STEP_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it('rejects an oversized STEP extracted from a ZIP with an error dialog (A4 ZIP path)', async () => {
    // The ZIP-extraction path checks extracted.stepBytes.byteLength, not file.size.
    const oversizeBuffer = new ArrayBuffer(STEP_MAX_BYTES + 1);
    vi.mocked(extractStepFromZip).mockReturnValue({
      fileName: 'huge-from-zip.step',
      stepBytes: oversizeBuffer,
    });

    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    useAppStore.getState().setActiveDocument(null);

    const fakeZipFile = { name: 'archive.zip', arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer };
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
      { getFile: async () => fakeZipFile } as unknown as FileSystemFileHandle,
    ]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('alertdialog').textContent).toMatch(/50\s*MB/i);
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  });
});
