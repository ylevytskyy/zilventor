import { useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { isImportedPart } from '@zilventor/shared';
import { CreatePartCommand } from '../../commands/CreatePartCommand';
import { AddExtrusionCommand } from '../../commands/AddExtrusionCommand';
import { OpenHoleDialogCommand } from '../../commands/OpenHoleDialogCommand';
import { OpenSweepDialogCommand } from '../../commands/OpenSweepDialogCommand';
import { OpenWorkPlaneDialogCommand } from '../../commands/OpenWorkPlaneDialogCommand';
import { OpenWorkAxisDialogCommand } from '../../commands/OpenWorkAxisDialogCommand';
import { OpenWorkPointDialogCommand } from '../../commands/OpenWorkPointDialogCommand';
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
  const readOnly = activePart ? isImportedPart(activePart) : false;
  const readOnlyTip = readOnly
    ? 'This part was imported from Inventor and is read-only. Re-author parametrically by creating a new part.'
    : undefined;

  const isExplodable = useAppStore((s) =>
    s.activeDocument?.kind === 'part' &&
    (s.activePart?.featureTree.some((f) => f.kind === 'imported') ?? false)
  );

  const handleExplode = async () => {
    const { kernel, bus } = useAppStore.getState();
    if (!kernel) return;
    try {
      const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
      const opfs = await Opfs.forNavigator();
      const { ExplodeIntoAssemblyCommand } = await import('../../commands/ExplodeIntoAssemblyCommand');
      await bus.execute(new ExplodeIntoAssemblyCommand({ kernel, opfs }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      useAppStore.getState().setStatus(`Explode failed: ${(e as Error).message}`);
    }
  };

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
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!hasSketch || readOnly} title={readOnlyTip} onClick={() => setExtrudeOpen(true)}>Extrude</button>
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!hasSketch || readOnly} title={readOnlyTip} onClick={() => useAppStore.getState().setRevolveDialogOpen(true)}>Revolve (R)</button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasSketch || readOnly}
          onClick={() => OpenSweepDialogCommand()}
          aria-label="Sweep"
          title={readOnly ? readOnlyTip : 'Sweep (W)'}
        >
          Sweep
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label="Explode into Assembly"
          disabled={!isExplodable}
          onClick={() => { void handleExplode(); }}
        >
          Explode into Assembly
        </button>
      </RibbonPanel>
      <RibbonPanel title="Work Features">
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!activePart || readOnly}
          onClick={() => OpenWorkPlaneDialogCommand()}
          aria-label="Work Plane"
          title={readOnly ? readOnlyTip : 'Work Plane (Ctrl+Shift+P)'}
        >
          Plane
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!activePart || readOnly}
          onClick={() => OpenWorkAxisDialogCommand()}
          aria-label="Work Axis"
          title={readOnly ? readOnlyTip : 'Work Axis (Ctrl+Shift+A)'}
        >
          Axis
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!activePart || readOnly}
          onClick={() => OpenWorkPointDialogCommand()}
          aria-label="Work Point"
          title={readOnly ? readOnlyTip : 'Work Point (Ctrl+Shift+W)'}
        >
          Point
        </button>
      </RibbonPanel>
      <RibbonPanel title="Modify">
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setFilletDialogOpen(true)}
        >
          Fillet (F)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setChamferDialogOpen(true)}
        >
          Chamfer (K)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setShellDialogOpen(true)}
        >
          Shell (S)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          onClick={() => OpenHoleDialogCommand()}
          title={readOnly ? readOnlyTip : 'Hole (H)'}
          aria-label="Hole"
        >
          Hole (H)
        </button>
      </RibbonPanel>
      <RibbonPanel title="Pattern">
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setLinearPatternDialogOpen(true)}
        >
          Linear Pattern (L)
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
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
