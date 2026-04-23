import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { EditParameterCommand } from '../commands/EditParameterCommand';

export default function PropertiesPanel() {
  const activePart = useAppStore((s) => s.activePart);
  const selectedFeatureId = useAppStore((s) => s.selectedFeatureId);

  const feature = activePart?.featureTree.find((f) => f.id === selectedFeatureId);
  const param = feature?.kind === 'extrude' ? activePart?.parameters[feature.distanceParam] : undefined;

  const [draft, setDraft] = useState(param?.expression ?? '');
  // Keep the input in sync when the underlying parameter changes (e.g. after undo/redo).
  useEffect(() => { setDraft(param?.expression ?? ''); }, [param?.expression]);

  if (!feature || !param) {
    return <div className="p-3 text-xs text-neutral-500">Select a feature</div>;
  }

  const submit = async () => {
    const { kernel, bus, activePart: ap, setActivePart, setStatus } = useAppStore.getState();
    if (!kernel || !ap) return;
    const v = Number(draft);
    if (!Number.isFinite(v)) return;
    await bus.execute(new EditParameterCommand({
      kernel,
      store: { activePart: ap, setActivePart },
      parameter: { name: param.name, expression: draft, value: v, unit: 'mm' }
    }));
    setStatus('Modified');
  };

  return (
    <div className="p-3 text-xs">
      <div className="font-semibold mb-2">{feature.id}</div>
      <label className="block">
        Distance
        <input
          aria-label="Distance"
          className="block w-full mt-1 bg-shell text-white px-2 py-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
      </label>
    </div>
  );
}
