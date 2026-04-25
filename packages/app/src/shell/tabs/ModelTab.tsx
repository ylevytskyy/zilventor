import { useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { CreatePartCommand } from '../../commands/CreatePartCommand';
import { AddExtrusionCommand } from '../../commands/AddExtrusionCommand';
import { OpenHoleDialogCommand } from '../../commands/OpenHoleDialogCommand';
import { OpenSweepDialogCommand } from '../../commands/OpenSweepDialogCommand';
import ExtrudeDialog, { type ExtrudeDialogValue } from '../ExtrudeDialog';

export default function ModelTab() {
  const activePart = useAppStore((s) => s.activePart);
  const [extrudeOpen, setExtrudeOpen] = useState(false);

  const handleNewPart = async () => {
    const { kernel, bus, setActivePart } = useAppStore.getState();
    if (!kernel) return;
    await bus.execute(new CreatePartCommand({ kernel, store: { setActivePart }, name: 'Part1' }));
  };

  const hasSketch = !!activePart?.featureTree.some((f) => f.kind === 'sketch');
  const hasRunningBody = !!activePart?.featureTree.some(
    (f) => f.kind === 'extrude' || f.kind === 'revolve'
  );

  const handleExtrudeCommit = async (v: ExtrudeDialogValue) => {
    const { kernel, bus, activePart: part, setActivePart } = useAppStore.getState();
    if (!kernel || !part) return;
    const d = Number(v.distance);
    if (!Number.isFinite(d) || d <= 0) return;
    const lastSketch = [...part.featureTree].reverse().find((f) => f.kind === 'sketch');
    if (!lastSketch) return;
    await bus.execute(new AddExtrusionCommand({
      kernel,
      store: { activePart: part, setActivePart },
      parameter: { name: 'd1', expression: String(d), value: d, unit: 'mm' },
      feature: {
        kind: 'extrude',
        id: `e${Date.now()}`,
        sketchRef: lastSketch.id,
        distanceParam: 'd1',
        direction: 'forward',
        operation: v.operation,
      },
    }));
    setExtrudeOpen(false);
  };

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Create">
        <button className="text-xs hover:text-white" onClick={handleNewPart}>New Part</button>
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!hasSketch} onClick={() => setExtrudeOpen(true)}>Extrude</button>
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!hasSketch} onClick={() => useAppStore.getState().setRevolveDialogOpen(true)}>Revolve (R)</button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasSketch}
          onClick={() => OpenSweepDialogCommand()}
          aria-label="Sweep"
          title="Sweep (W)"
        >
          Sweep
        </button>
      </RibbonPanel>
      <RibbonPanel title="Modify">
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody}
          onClick={() => useAppStore.getState().setFilletDialogOpen(true)}
        >
          Fillet (F)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody}
          onClick={() => useAppStore.getState().setChamferDialogOpen(true)}
        >
          Chamfer (K)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody}
          onClick={() => useAppStore.getState().setShellDialogOpen(true)}
        >
          Shell (S)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody}
          onClick={() => OpenHoleDialogCommand()}
          title="Hole (H)"
          aria-label="Hole"
        >
          Hole (H)
        </button>
      </RibbonPanel>
      <RibbonPanel title="Pattern">
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody}
          onClick={() => useAppStore.getState().setLinearPatternDialogOpen(true)}
        >
          Linear Pattern (L)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody}
          onClick={() => useAppStore.getState().setMirrorDialogOpen(true)}
        >
          Mirror (M)
        </button>
      </RibbonPanel>
      <RibbonPanel title="Parameters">
        <button className="text-xs hover:text-white" onClick={() => useAppStore.getState().setParametersPanelOpen(true)}>Parameters…</button>
      </RibbonPanel>
      {extrudeOpen && (
        <ExtrudeDialog
          hasRunningBody={hasRunningBody}
          onCommit={(v) => { void handleExtrudeCommit(v); }}
          onCancel={() => setExtrudeOpen(false)}
        />
      )}
    </div>
  );
}
