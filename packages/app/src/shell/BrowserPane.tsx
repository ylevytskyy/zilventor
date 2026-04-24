import type { PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type Props = { part: PartDocument | null };

export default function BrowserPane({ part }: Props) {
  const setSelectedFeature = useAppStore((s) => s.setSelectedFeature);
  const featureErrors = useAppStore((s) => s.featureErrors);

  if (!part) {
    return <div className="px-3 py-2 text-xs text-neutral-500">No part open</div>;
  }

  // T26: render a warning badge next to a feature that failed during executeTree.
  // Click opens the fillet dialog as a best-effort re-open stub — full
  // re-open-in-edit-mode pre-populated with the offending feature's state is
  // deferred to a follow-up task (requires dialog to accept an
  // `existingFeature` prop — not in scope for 3b).
  const renderErrorBadge = (featureId: string) => {
    const err = featureErrors.get(featureId);
    if (!err) return null;
    return (
      <button
        type="button"
        data-feature-error={err.kind}
        aria-label={`Feature ${featureId} has errors`}
        title={err.message}
        onClick={() => {
          // TODO(post-3b): re-open the originating feature's dialog and
          // pre-populate it with the offending feature's current state so the
          // user can edit and retry. For T26 we best-effort open the fillet
          // dialog since fillet is the primary failing feature today.
          useAppStore.getState().setFilletDialogOpen?.(true);
        }}
        style={{
          color: '#ff6b6b',
          background: 'transparent',
          border: 'none',
          padding: '0 4px',
          cursor: 'pointer',
          marginLeft: 4
        }}
      >⚠</button>
    );
  };

  let sketchCount = 0;
  let extrudeCount = 0;
  let revolveCount = 0;
  let filletCount = 0;
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
              >
                ▸ Sketch{sketchCount} ({f.primitives.length})
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'revolve') {
            revolveCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => setSelectedFeature(f.id)}
              >
                ▸ Revolve{revolveCount}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'fillet') {
            filletCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => setSelectedFeature(f.id)}
              >
                ▸ Fillet{filletCount}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          extrudeCount += 1;
          return (
            <li
              key={f.id}
              className="pl-3 cursor-pointer hover:text-white"
              onDoubleClick={() => setSelectedFeature(f.id)}
            >
              ▸ Extrusion{extrudeCount}
              {renderErrorBadge(f.id)}
            </li>
          );
        })}
        <li className="pl-3 text-neutral-500">End of Part</li>
      </ul>
    </div>
  );
}
