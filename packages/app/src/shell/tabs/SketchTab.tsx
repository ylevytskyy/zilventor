import { useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import SketchRectangleDialog from '../SketchRectangleDialog';

export default function SketchTab() {
  const activePart = useAppStore((s) => s.activePart);
  const [sketching, setSketching] = useState(false);
  const [rectOpen, setRectOpen] = useState(false);
  const canSketch = !!activePart;

  const handleStartSketch = () => {
    useAppStore.getState().setStatus('Sketch in progress');
    setSketching(true);
  };
  const handleFinishSketch = () => {
    useAppStore.getState().setStatus('Ready');
    setSketching(false);
  };

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Sketch">
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!canSketch || sketching} onClick={handleStartSketch}>2D Sketch</button>
        {sketching && <button className="text-xs hover:text-white" onClick={handleFinishSketch}>Finish Sketch</button>}
      </RibbonPanel>
      <RibbonPanel title="Draw">
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!sketching} onClick={() => setRectOpen(true)}>Rectangle</button>
      </RibbonPanel>
      <RibbonPanel title="Constrain">
        <button className="text-xs text-neutral-500" disabled>Constraints (SP2)</button>
      </RibbonPanel>
      {rectOpen && <SketchRectangleDialog onClose={() => setRectOpen(false)} />}
    </div>
  );
}
