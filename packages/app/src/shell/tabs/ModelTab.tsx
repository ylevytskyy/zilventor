import RibbonPanel from '../RibbonPanel';
export default function ModelTab() {
  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Create">
        <button className="text-xs">New Part</button>
        <button className="text-xs">Extrude</button>
      </RibbonPanel>
      <RibbonPanel title="Modify">
        <button className="text-xs text-neutral-500" disabled>Fillet (SP3)</button>
      </RibbonPanel>
    </div>
  );
}
