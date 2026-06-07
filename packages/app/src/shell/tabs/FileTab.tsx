import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { CreatePartCommand } from '../../commands/CreatePartCommand';
import { NewAssemblyCommand } from '../../commands/NewAssemblyCommand';
import { readTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackAssembly, packAssembly, unpackAssemblyWithTextures } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { globalCustomTextureRegistry } from '../../textures/customTextureRegistry';
import { unpackDrawing, packDrawing } from '../../storage/DrawingPacker';
import { saveBlob, pickFile, hasDirectoryPicker } from '../fsaFallback';
import { activateDrawingDocument } from '../../drawing/activateDrawingDocument';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { startImportTicker } from '../../import/importTicker';
import { isSolidWorksNativeFile, SOLIDWORKS_GUIDANCE } from '../../import/solidworksGuidance';
import { triggerDownload } from '../../nesting/triggerDownload';

export default function FileTab() {
  const activePart = useAppStore((s) => s.activePart);
  const activeDoc = useAppStore((s) => s.activeDocument);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const [transparentBg, setTransparentBg] = useState(false);

  const handleExportImage = async (transparent: boolean) => {
    const { viewport, activeDocument } = useAppStore.getState();
    if (!viewport || !activeDocument) return;
    try {
      const bytes = await viewport.captureViewportPng({ transparent });
      const name = activeDocument.document.name;
      await triggerDownload(
        new Blob([bytes], { type: 'image/png' }),
        { suggestedName: `${name}.png`, mimeType: 'image/png', extension: 'png', description: 'Image PNG' },
      );
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setErrorDialog(`Export failed: ${(e as Error).message}`);
    }
  };

  const handleNewPart = async () => {
    const { kernel, bus, setActivePart } = useAppStore.getState();
    if (!kernel) return;
    await bus.execute(new CreatePartCommand({ kernel, store: { setActivePart }, name: 'Part1' }));
  };

  const handleNewAssembly = (): void => {
    NewAssemblyCommand({ name: 'untitled-assembly' });
  };

  const handleSaveAs = async () => {
    const { kernel, viewport, setStatus, activeDocument } = useAppStore.getState();
    if (!activeDocument) return;

    try {
      let thumbnail: Uint8Array | undefined;
      if (viewport) {
        try {
          thumbnail = await viewport.captureThumbnail(256, 256);
        } catch {
          thumbnail = undefined;
        }
      }

      if (activeDocument.kind === 'drawing') {
        const doc = activeDocument.document;
        const archive = await packDrawing(doc);
        const saved = await saveBlob(
          new Blob([archive.buffer as ArrayBuffer]),
          `${doc.name}.zidw`,
          [{ description: 'ZilInventor drawing', accept: { 'application/zilinventor-drawing': ['.zidw'] } }],
        );
        if (saved) setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
        return;
      }
      if (activeDocument.kind === 'assembly') {
        const doc = activeDocument.document;
        const archive = await packAssembly(doc, thumbnail ?? new Uint8Array());
        const saved = await saveBlob(
          new Blob([archive.buffer as ArrayBuffer]),
          `${doc.name}.ziasm`,
          [{ description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } }],
        );
        if (saved) setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
        return;
      }

      // Part path
      if (!kernel || !activePart) return;
      const bytes = await kernel.saveToBytes(activePart.id, thumbnail);
      const saved = await saveBlob(
        new Blob([bytes.buffer as ArrayBuffer]),
        `${activePart.name}.zipt`,
        [{ description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } }],
      );
      if (saved) setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setErrorDialog(`Save failed: ${(e as Error).message}`);
    }
  };

  const handleOpen = async () => {
    const { kernel, setActivePart, setActiveDocument, setStatus, bus, beginFileOpen, endFileOpen } = useAppStore.getState();
    if (!kernel) return;

    let token = -1;
    try {
      const file = await pickFile([
        { description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } },
        { description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } },
        { description: 'ZilInventor drawing', accept: { 'application/zilinventor-drawing': ['.zidw'] } },
        { description: 'STEP file', accept: { 'application/step': ['.step', '.stp'] } },
        { description: 'SolidWorks file', accept: { 'application/sldworks': ['.sldprt', '.sldasm'] } },
        { description: 'ZIP archive (with STEP inside)', accept: { 'application/zip': ['.zip'] } },
      ]);
      if (!file) return;

      // SolidWorks native files can't be read directly — guide the user to STEP.
      if (isSolidWorksNativeFile(file.name)) {
        setErrorDialog(SOLIDWORKS_GUIDANCE);
        return;
      }

      token = beginFileOpen(file.name);

      // ZIP branch: extract first STEP entry and re-dispatch through the same pipeline
      if (/\.zip$/i.test(file.name)) {
        const { extractStepFromZip } = await import('../../import/extractStepFromZip');
        const zipBytes = new Uint8Array(await file.arrayBuffer());
        const extracted = extractStepFromZip(zipBytes);
        if (!extracted) {
          setErrorDialog(
            "No STEP/STP file found in archive. The site you downloaded from may offer a 'STEP' format option — try re-downloading in that format.",
          );
          return;
        }
        const stopTicker = startImportTicker(setStatus, () => useAppStore.getState().fileOpenSeq === token);
        try {
          const { activeDocument } = useAppStore.getState();
          if (activeDocument?.kind === 'assembly') {
            const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
            const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
            const opfs = await Opfs.forNavigator();
            const cmd = new ImportStepAsComponentCommand({ stepBytes: extracted.stepBytes, fileName: extracted.fileName, kernel, opfs });
            await bus.execute(cmd);
          } else {
            const { importStepIntoNewPart } = await import('../../import/importStepIntoNewPart');
            // importStepIntoNewPart expects a File; synthesize one from the extracted bytes
            const stepFile = new File([extracted.stepBytes], extracted.fileName, { type: 'application/step' });
            const { part } = await importStepIntoNewPart(stepFile, kernel);
            stopTicker();
            setActivePart(part);
            setStatus('Imported');
          }
        } finally {
          stopTicker();
        }
        return;
      }

      // STEP early-branch: dispatch by active document kind
      if (/\.(step|stp)$/i.test(file.name)) {
        const stopTicker = startImportTicker(setStatus, () => useAppStore.getState().fileOpenSeq === token);
        try {
          const { activeDocument } = useAppStore.getState();
          if (activeDocument?.kind === 'assembly') {
            const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
            const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
            const opfs = await Opfs.forNavigator();
            const stepBytes = await file.arrayBuffer();
            const cmd = new ImportStepAsComponentCommand({ stepBytes, fileName: file.name, kernel, opfs });
            await bus.execute(cmd);
          } else {
            // Part-mode: import the whole compound shape (all solids + non-solid geometry).
            // Use the Explode-into-Assembly command if individual bodies are needed.
            const stepBytes = await file.arrayBuffer();
            const { buildImportedPartDocument } = await import('../../import/buildImportedPartDocument');
            const { stepFilenameBasename } = await import('../../import/originFeatures');
            const baseName = stepFilenameBasename(file.name);
            const importResult = await kernel.importStep({ stepBytes, partName: baseName });
            const firstSolidColor = importResult.solidColors?.find((c) => c !== null) ?? undefined;
            const part = buildImportedPartDocument(baseName, importResult.brepBlobId, file.name, undefined, firstSolidColor);
            await kernel.registerPart(part);
            stopTicker();
            setActivePart(part);
            setStatus('Imported');
          }
        } finally {
          stopTicker();
        }
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = await readTarGz(bytes);
      const manifestEntry = entries.find((e) => e.name === 'manifest.json');
      if (!manifestEntry) throw new Error('No manifest.json in archive');
      const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
      const kind = manifest.kind ?? 'part'; // legacy v7 default

      if (kind === 'drawing') {
        const doc = await unpackDrawing(bytes);
        const opfs = await Opfs.forNavigator();
        await activateDrawingDocument(doc, { kernel, opfs });
        // Status is set by activateDrawingDocument (happy path → 'Opened';
        // assembly/missing-source paths → their own notices). Do NOT call setStatus here.
        return;
      }
      if (kind === 'assembly') {
        const { doc, textures } = await unpackAssemblyWithTextures(bytes);
        globalCustomTextureRegistry.revokeAll();
        const asmDefs = doc.customTextures ?? [];
        if (asmDefs.length && Object.keys(textures).length) {
          globalCustomTextureRegistry.register(asmDefs, textures);
        }
        // Clear SM texture caches so rebuilt blob URLs are used, not stale ones.
        useAppStore.getState().viewport?.getSceneManager()?.setCustomTextureRegistry(globalCustomTextureRegistry);
        setActiveDocument({ kind: 'assembly', document: doc });
        setStatus('Opened');
      } else {
        // part path
        const partId = await kernel.loadFromBytes(bytes);
        try {
          const { manifest, textures } = await unpackProject(bytes);
          globalCustomTextureRegistry.revokeAll();
          const partDefs = (manifest as { document?: { customTextures?: unknown[] } }).document?.customTextures ?? [];
          if (partDefs.length && textures && Object.keys(textures).length) {
            globalCustomTextureRegistry.register(partDefs as Parameters<typeof globalCustomTextureRegistry.register>[0], textures);
          }
          // Clear SM texture caches so rebuilt blob URLs are used, not stale ones.
          useAppStore.getState().viewport?.getSceneManager()?.setCustomTextureRegistry(globalCustomTextureRegistry);
        } catch {
          // Non-fatal — textures just won't render.
        }
        const part = await kernel.getPart(partId);
        setActivePart(part);
        setStatus('Opened');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // If this open was cancelled or superseded, the worker was torn down on
      // purpose — swallow the resulting rejection instead of flashing an error.
      if (token !== -1 && useAppStore.getState().fileOpenSeq !== token) return;
      const msg = (e as Error).message;
      if (/newer/i.test(msg)) {
        setErrorDialog('This file was saved by a newer ZilInventor. Update to open.');
      } else if (/gzip|corrupt/i.test(msg)) {
        setErrorDialog("Can't open this file — it may be corrupted.");
      } else {
        setErrorDialog(`Open failed: ${msg}`);
      }
    } finally {
      if (token !== -1) endFileOpen(token);
    }
  };

  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button className="hover:text-white" onClick={handleNewPart}>New Part</button>
      <button className="hover:text-white" onClick={handleNewAssembly}>New Assembly</button>
      <button className="hover:text-white" onClick={handleOpen}>Open…</button>
      <button className="hover:text-white" disabled>Save</button>
      <button className="hover:text-white disabled:text-neutral-500" disabled={!activeDoc} onClick={handleSaveAs}>Save As…</button>
      <label className="flex items-center gap-1 select-none">
        <input
          type="checkbox"
          checked={transparentBg}
          onChange={(e) => setTransparentBg(e.target.checked)}
        />
        Transparent
      </label>
      <button
        className="hover:text-white disabled:text-neutral-500"
        disabled={!activeDoc || activeDoc.kind === 'drawing'}
        onClick={() => handleExportImage(transparentBg)}
      >
        Export Image
      </button>
      <button
        className="hover:text-white disabled:text-neutral-500"
        disabled={!hasDirectoryPicker()}
        title={hasDirectoryPicker() ? undefined : 'Import from Inventor requires Chrome, Edge, Brave, or Arc (uses showDirectoryPicker)'}
        onClick={() => useAppStore.getState().setImportFromInventorDialogOpen(true)}
      >
        Import from Inventor
      </button>
      {errorDialog && (
        <div role="alertdialog" aria-label="Error" className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-shell-panel border border-shell-border p-4 w-80 text-xs">
            <div className="text-sm mb-3">{errorDialog}</div>
            <div className="flex justify-end">
              <button onClick={() => setErrorDialog(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
