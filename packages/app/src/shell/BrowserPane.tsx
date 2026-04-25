import type { Feature, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { SketchPickController } from '../model/SketchPickController';

type Props = { part: PartDocument | null; sketchPicker?: SketchPickController | null };

type WorkFeature = Extract<Feature, { kind: 'workAxis' | 'workPlane' | 'workPoint' }>;

function isOriginFeatureId(id: string): boolean {
  return id.startsWith('origin.');
}

export default function BrowserPane({ part, sketchPicker }: Props) {
  const setSelectedFeature = useAppStore((s) => s.setSelectedFeature);
  const featureErrors = useAppStore((s) => s.featureErrors);
  const activeDoc = useAppStore((s) => s.activeDocument);

  if (activeDoc?.kind === 'assembly') {
    const asm = activeDoc.document;
    return (
      <div className="px-3 py-2 text-xs text-neutral-200" data-testid="browser-pane">
        <div className="font-semibold mb-1">Assembly: {asm.name}</div>
        <ul className="space-y-0.5">
          <li className="pl-3">Origin</li>
          <li className="pl-3">Components ({asm.components.length})</li>
          {asm.components.map((c) => {
            const partFileName = c.partPath.split('/').pop()!.replace(/\.zipt$/, '');
            return (
              <li
                key={c.id}
                className="pl-6 cursor-pointer hover:text-white"
                onDoubleClick={() => {
                  useAppStore.getState().openEditComponentDialog(c.id);
                }}
              >
                ▸ {c.id} — {partFileName}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (!part) {
    return <div className="px-3 py-2 text-xs text-neutral-500">No part open</div>;
  }

  const openWorkFeatureForEdit = (kind: WorkFeature['kind'], id: string) => {
    const s = useAppStore.getState();
    if (kind === 'workAxis') s.openWorkAxisForEdit(id);
    else if (kind === 'workPlane') s.openWorkPlaneForEdit(id);
    else s.openWorkPointForEdit(id);
  };

  // Render a warning badge next to a feature that failed during executeTree.
  // Clicking the badge re-opens the feature's dialog pre-populated with the
  // offending feature's stored state so the user can edit-and-retry.
  const renderErrorBadge = (featureId: string) => {
    const err = featureErrors.get(featureId);
    if (!err) return null;
    return (
      <button
        type="button"
        data-feature-error={err.kind}
        aria-label={`Feature ${featureId} has errors`}
        title={err.message}
        onClick={(e) => {
          e.stopPropagation();
          const parent = part.featureTree.find((f) => f.id === featureId);
          if (parent?.kind === 'fillet') {
            useAppStore.getState().openFilletForEdit(featureId);
          } else if (parent?.kind === 'workAxis' || parent?.kind === 'workPlane' || parent?.kind === 'workPoint') {
            openWorkFeatureForEdit(parent.kind, featureId);
          } else {
            // Fallback: open the fillet dialog if we can't identify the
            // failing feature's kind.
            useAppStore.getState().setFilletDialogOpen(true);
          }
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

  const renderVisibilityToggle = (featureId: string, visible: boolean) => (
    <button
      type="button"
      aria-label={`Toggle visibility for ${featureId}`}
      onClick={(e) => {
        e.stopPropagation();
        useAppStore.getState().setWorkFeatureVisible(featureId, !visible);
      }}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '0 4px',
        cursor: 'pointer',
        color: visible ? '#a3e635' : '#6b7280',
        marginRight: 2,
      }}
    >{visible ? '◉' : '○'}</button>
  );

  const originFeatures = part.featureTree.filter(
    (f): f is WorkFeature =>
      (f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint') &&
      isOriginFeatureId(f.id),
  );

  let sketchCount = 0;
  let extrudeCount = 0;
  let revolveCount = 0;
  let filletCount = 0;
  let chamferCount = 0;
  let shellCount = 0;
  let workPlaneCount = 0;
  let workAxisCount = 0;
  let workPointCount = 0;
  return (
    <div className="px-3 py-2 text-xs text-neutral-200">
      <div className="font-semibold mb-1">{part.name}</div>
      <ul className="space-y-0.5">
        <li className="pl-3">
          <details data-testid="origin-group" open>
            <summary className="cursor-pointer">Origin</summary>
            <ul className="space-y-0.5 pl-4">
              {originFeatures.map((f) => (
                <li
                  key={f.id}
                  className="cursor-pointer hover:text-white"
                  onDoubleClick={() => openWorkFeatureForEdit(f.kind, f.id)}
                >
                  {renderVisibilityToggle(f.id, f.visible)}
                  {f.id}
                  {renderErrorBadge(f.id)}
                </li>
              ))}
            </ul>
          </details>
        </li>
        {part.featureTree.map((f) => {
          if ((f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint') && isOriginFeatureId(f.id)) {
            return null;
          }
          if (f.kind === 'sketch') {
            sketchCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                data-sketch-primitive-count={f.primitives.length}
                onClick={() => sketchPicker?.selectFromBrowser(f.id)}
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
                onDoubleClick={() => {
                  setSelectedFeature(f.id);
                  useAppStore.getState().openFilletForEdit(f.id);
                }}
              >
                ▸ Fillet{filletCount}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'chamfer') {
            chamferCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => {
                  setSelectedFeature(f.id);
                  useAppStore.getState().openChamferForEdit(f.id);
                }}
              >
                ▸ Chamfer{chamferCount}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'shell') {
            shellCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => {
                  setSelectedFeature(f.id);
                  useAppStore.getState().openShellForEdit(f.id);
                }}
              >
                ▸ Shell{shellCount}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'hole') {
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => {
                  setSelectedFeature(f.id);
                  useAppStore.getState().openHoleForEdit(f.id);
                }}
              >
                ▸ Hole {f.id}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'sweep') {
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => {
                  setSelectedFeature(f.id);
                  useAppStore.getState().openSweepForEdit(f.id);
                }}
              >
                ▸ Sweep {f.id}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'workPlane') {
            workPlaneCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => openWorkFeatureForEdit('workPlane', f.id)}
              >
                {renderVisibilityToggle(f.id, f.visible)}
                ▸ Plane{workPlaneCount}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'workAxis') {
            workAxisCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => openWorkFeatureForEdit('workAxis', f.id)}
              >
                {renderVisibilityToggle(f.id, f.visible)}
                ▸ Axis{workAxisCount}
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'workPoint') {
            workPointCount += 1;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white"
                onDoubleClick={() => openWorkFeatureForEdit('workPoint', f.id)}
              >
                {renderVisibilityToggle(f.id, f.visible)}
                ▸ Point{workPointCount}
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
