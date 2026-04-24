import { useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { CreatePartCommand } from '../../commands/CreatePartCommand';
import ExtrudeDialog from '../ExtrudeDialog';

export default function ModelTab() {
  const activePart = useAppStore((s) => s.activePart);
  const [extrudeOpen, setExtrudeOpen] = useState(false);

  const handleNewPart = async () => {
    const { kernel, bus, setActivePart } = useAppStore.getState();
    if (!kernel) return;
    await bus.execute(new CreatePartCommand({ kernel, store: { setActivePart }, name: 'Part1' }));
  };

  const hasSketch = !!activePart?.featureTree.some((f) => f.kind === 'sketch');

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Create">
        <button className="text-xs hover:text-white" onClick={handleNewPart}>New Part</button>
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!hasSketch} onClick={() => setExtrudeOpen(true)}>Extrude</button>
      </RibbonPanel>
      <RibbonPanel title="Modify">
        <button className="text-xs text-neutral-500" disabled>Fillet (SP3)</button>
      </RibbonPanel>
      <RibbonPanel title="Parameters">
        <button className="text-xs hover:text-white" onClick={() => useAppStore.getState().setParametersPanelOpen(true)}>Parameters…</button>
      </RibbonPanel>
      {extrudeOpen && <ExtrudeDialog onClose={() => setExtrudeOpen(false)} />}
    </div>
  );
}
