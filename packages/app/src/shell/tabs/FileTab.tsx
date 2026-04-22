import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { CreatePartCommand } from '../../commands/CreatePartCommand';

type FSAWindow = Window & {
  showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]>;
};

export default function FileTab() {
  const activePart = useAppStore((s) => s.activePart);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);

  const handleNewPart = async () => {
    const { kernel, bus, setActivePart } = useAppStore.getState();
    if (!kernel) return;
    await bus.execute(new CreatePartCommand({ kernel, store: { setActivePart }, name: 'Part1' }));
  };

  const handleSaveAs = async () => {
    const { kernel, viewport, setStatus } = useAppStore.getState();
    if (!kernel || !activePart) return;
    try {
      // Thumbnail is a nice-to-have — if the viewport isn't ready or the
      // canvas read-back fails for any reason, proceed with the save anyway.
      let thumbnail: Uint8Array | undefined;
      if (viewport) {
        try {
          thumbnail = await viewport.captureThumbnail(256, 256);
        } catch {
          thumbnail = undefined;
        }
      }
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
    const { kernel, setActivePart, setStatus } = useAppStore.getState();
    if (!kernel) return;
    try {
      const [handle] = await (window as unknown as FSAWindow).showOpenFilePicker({
        types: [{ description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } }]
      });
      if (!handle) return;
      const partId = await kernel.load(handle);
      const part = await kernel.getPart(partId);
      setActivePart(part);
      setStatus('Opened');
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
      <button className="hover:text-white" onClick={handleOpen}>Open…</button>
      <button className="hover:text-white" disabled>Save</button>
      <button className="hover:text-white disabled:text-neutral-500" disabled={!activePart} onClick={handleSaveAs}>Save As…</button>
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
