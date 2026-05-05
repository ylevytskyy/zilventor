import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { CreatePartCommand } from '../../commands/CreatePartCommand';
import { NewAssemblyCommand } from '../../commands/NewAssemblyCommand';
import { readTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackAssembly, packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { writeToHandle } from '@zilventor/kernel/src/storage/FileSystemAccess';

type FSAWindow = Window & {
  showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]>;
};

export default function FileTab() {
  const activePart = useAppStore((s) => s.activePart);
  const activeDoc = useAppStore((s) => s.activeDocument);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);

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
        // TODO Sub-project 6: implement drawing save
        return;
      }
      if (activeDocument.kind === 'assembly') {
        const doc = activeDocument.document;
        const handle = await (window as unknown as FSAWindow).showSaveFilePicker({
          suggestedName: `${doc.name}.ziasm`,
          types: [{ description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } }]
        });
        const archive = await packAssembly(doc, thumbnail ?? new Uint8Array());
        await writeToHandle(handle, archive);
        setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
        return;
      }

      // Part path (existing behavior)
      if (!kernel || !activePart) return;
      const handle = await (window as unknown as FSAWindow).showSaveFilePicker({
        suggestedName: `${activePart.name}.zipt`,
        types: [{ description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } }]
      });
      await kernel.save(activePart.id, handle, thumbnail);
      setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setErrorDialog(`Save failed: ${(e as Error).message}`);
    }
  };

  const handleOpen = async () => {
    const { kernel, setActivePart, setActiveDocument, setStatus } = useAppStore.getState();
    if (!kernel) return;
    try {
      const [handle] = await (window as unknown as FSAWindow).showOpenFilePicker({
        types: [
          { description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } },
          { description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } },
        ]
      });
      if (!handle) return;

      // Peek the manifest to discriminate kind before branching
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = await readTarGz(bytes);
      const manifestEntry = entries.find((e) => e.name === 'manifest.json');
      if (!manifestEntry) throw new Error('No manifest.json in archive');
      const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
      const kind = manifest.kind ?? 'part'; // legacy v7 default

      if (kind === 'drawing') {
        // TODO Sub-project 6: implement drawing open
        return;
      }
      if (kind === 'assembly') {
        const doc = await unpackAssembly(bytes);
        setActiveDocument({ kind: 'assembly', document: doc });
        setStatus('Opened');
      } else {
        // part path — keep calling kernel.load(handle) to preserve existing behaviour
        const partId = await kernel.load(handle);
        const part = await kernel.getPart(partId);
        setActivePart(part);
        setStatus('Opened');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const msg = (e as Error).message;
      if (/newer/i.test(msg)) {
        setErrorDialog('This file was saved by a newer ZilInventor. Update to open.');
      } else if (/gzip|corrupt/i.test(msg)) {
        setErrorDialog("Can't open this file — it may be corrupted.");
      } else {
        setErrorDialog(`Open failed: ${msg}`);
      }
    }
  };

  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button className="hover:text-white" onClick={handleNewPart}>New Part</button>
      <button className="hover:text-white" onClick={handleNewAssembly}>New Assembly</button>
      <button className="hover:text-white" onClick={handleOpen}>Open…</button>
      <button className="hover:text-white" disabled>Save</button>
      <button className="hover:text-white disabled:text-neutral-500" disabled={!activeDoc} onClick={handleSaveAs}>Save As…</button>
      <button
        className="hover:text-white"
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
