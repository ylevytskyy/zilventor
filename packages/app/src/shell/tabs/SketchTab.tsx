import RibbonPanel from '../RibbonPanel';
export default function SketchTab() {
  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Sketch"><button className="text-xs">2D Sketch</button></RibbonPanel>
      <RibbonPanel title="Draw"><button className="text-xs">Rectangle</button></RibbonPanel>
      <RibbonPanel title="Constrain"><button className="text-xs text-neutral-500" disabled>Constraints (SP2)</button></RibbonPanel>
    </div>
  );
}
