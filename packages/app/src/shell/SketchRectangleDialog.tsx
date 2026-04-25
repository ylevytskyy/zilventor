import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddSketchCommand } from '../commands/AddSketchCommand';

export default function SketchRectangleDialog({ onClose }: { onClose(): void }) {
  const [x1, setX1] = useState('0');
  const [y1, setY1] = useState('0');
  const [x2, setX2] = useState('100');
  const [y2, setY2] = useState('200');

  const submit = async () => {
    const { kernel, bus, activePart, setActivePart } = useAppStore.getState();
    if (!kernel || !activePart) return;
    const ax = Number(x1), ay = Number(y1), bx = Number(x2), by = Number(y2);
    const x = Math.min(ax, bx), y = Math.min(ay, by);
    const w = Math.abs(bx - ax), h = Math.abs(by - ay);
    await bus.execute(new AddSketchCommand({
      kernel,
      store: { activePart, setActivePart },
      feature: { kind: 'sketch', id: `s${Date.now()}`, plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [{ id: `p${Date.now()}`, kind: 'rectangle', x, y, w, h }], constraints: [] }
    }));
    onClose();
  };

  return (
    <div role="dialog" aria-label="Rectangle dialog" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-shell-panel border border-shell-border p-4 w-72 text-xs">
        <h3 className="mb-3 text-sm">Rectangle (two corner points)</h3>
        <div className="grid grid-cols-2 gap-2">
          <label>x1 <input aria-label="x1" className="bg-shell text-white px-2 py-1 w-full" value={x1} onChange={(e) => setX1(e.target.value)} /></label>
          <label>y1 <input aria-label="y1" className="bg-shell text-white px-2 py-1 w-full" value={y1} onChange={(e) => setY1(e.target.value)} /></label>
          <label>x2 <input aria-label="x2" className="bg-shell text-white px-2 py-1 w-full" value={x2} onChange={(e) => setX2(e.target.value)} /></label>
          <label>y2 <input aria-label="y2" className="bg-shell text-white px-2 py-1 w-full" value={y2} onChange={(e) => setY2(e.target.value)} /></label>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={onClose}>Cancel</button>
          <button className="font-semibold" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}
