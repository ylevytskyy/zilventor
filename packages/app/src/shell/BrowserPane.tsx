import type { PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type Props = { part: PartDocument | null };

export default function BrowserPane({ part }: Props) {
  const setSelectedFeature = useAppStore((s) => s.setSelectedFeature);

  if (!part) {
    return <div className="px-3 py-2 text-xs text-neutral-500">No part open</div>;
  }
  let sketchCount = 0;
  let extrudeCount = 0;
  return (
    <div className="px-3 py-2 text-xs text-neutral-200">
      <div className="font-semibold mb-1">{part.name}</div>
      <ul className="space-y-0.5">
        <li className="pl-3">Origin</li>
        {part.featureTree.map((f) => {
          if (f.kind === 'sketch') {
            sketchCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                data-sketch-primitive-count={f.primitives.length}
                onDoubleClick={() => setSelectedFeature(f.id)}
              >▸ Sketch{sketchCount} ({f.primitives.length})</li>
            );
          }
          extrudeCount += 1;
          return (
            <li
              key={f.id}
              className="pl-3 cursor-pointer hover:text-white"
              onDoubleClick={() => setSelectedFeature(f.id)}
            >▸ Extrusion{extrudeCount}</li>
          );
        })}
        <li className="pl-3 text-neutral-500">End of Part</li>
      </ul>
    </div>
  );
}
