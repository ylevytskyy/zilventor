import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddExtrusionCommand } from '../commands/AddExtrusionCommand';

export default function ExtrudeDialog({ onClose }: { onClose(): void }) {
  const [distance, setDistance] = useState('18');

  const submit = async () => {
    const { kernel, bus, activePart, setActivePart } = useAppStore.getState();
    if (!kernel || !activePart) return;
    const d = Number(distance);
    if (!Number.isFinite(d) || d <= 0) return;
    const lastSketch = [...activePart.featureTree].reverse().find((f) => f.kind === 'sketch');
    if (!lastSketch) return;
    await bus.execute(new AddExtrusionCommand({
      kernel,
      store: { activePart, setActivePart },
      parameter: { name: 'd1', expression: String(d), value: d, unit: 'mm' },
      feature: { kind: 'extrude', id: `e${Date.now()}`, sketchRef: lastSketch.id, distanceParam: 'd1', direction: 'forward' }
    }));
    onClose();
  };

  return (
    <div role="dialog" aria-label="Extrude dialog" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-shell-panel border border-shell-border p-4 w-64 text-xs">
        <h3 className="mb-3 text-sm">Extrude</h3>
        <label>Distance
          <input aria-label="Distance" className="block w-full mt-1 bg-shell text-white px-2 py-1" value={distance} onChange={(e) => setDistance(e.target.value)} />
        </label>
        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={onClose}>Cancel</button>
          <button className="font-semibold" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}
