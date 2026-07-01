import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DrawingTreePane } from '../drawing/DrawingTreePane';
import type { AssemblyDocument, ComponentInstance, Feature, PanelFeature, PartDocument, PartInfo } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { PanelIcon } from '@zilventor/icons';
import { useAppStore } from '../store/useAppStore';
import type { SketchPickController } from '../model/SketchPickController';
import { BomTable } from './BomTable';
import { CutListTable } from './CutListTable';
import { HardwareTable } from './HardwareTable';
import { ConnectorBomTable } from './ConnectorBomTable';
import { useConnectorBomResult } from './useConnectorBomResult';
import { aggregateHardwareRecursive } from '../assembly/walkers/aggregateHardwareRecursive';
import { buildHardwareCache } from '../assembly/walkers/buildHardwareCache';
import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';
import { SetComponentColorOverrideCommand } from '../commands/SetComponentColorOverrideCommand';
import { OpenProjectFileCommand } from '../commands/OpenProjectFileCommand';
import { EditPanelFeatureCommand } from '../commands/EditPanelFeatureCommand';
import { OpenCutListTabCommand } from '../commands/OpenCutListTabCommand';
import { OpenNestingTabCommand } from '../commands/OpenNestingTabCommand';
import { SetCutListItemNumberCommand } from '../commands/SetCutListItemNumberCommand';
import { ExportCutListCsvCommand } from '../commands/ExportCutListCsvCommand';
import { useCutListResult } from './useCutListResult';
import { useCutListCacheContext } from './CutListCacheContext';
import { NestingTab } from './NestingTab';

type Props = {
  part: PartDocument | null;
  sketchPicker?: SketchPickController | null;
  partInfo?: Map<string, PartInfo>;
  showToast?: ((message: string) => void) | undefined;
};

type WorkFeature = Extract<Feature, { kind: 'workAxis' | 'workPlane' | 'workPoint' }>;

function isOriginFeatureId(id: string): boolean {
  return id.startsWith('origin.');
}

type RenderTreeArgs = {
  components: ComponentInstance[];
  doc: AssemblyDocument;
  constraintLabel: (kind: string) => string;
  selectedConstraintId: string | null | undefined;
};

function renderAssemblyTree(args: RenderTreeArgs): JSX.Element {
  return <AssemblyTree {...args} />;
}

function AssemblyTree({ components, doc, constraintLabel, selectedConstraintId }: RenderTreeArgs): JSX.Element {
  const { t } = useTranslation();
  const subAsmDocs = useAppStore((s) => s.subAssemblyDocs);
  const expanded = useAppStore((s) => s.expandedSubAsmPaths);

  function renderNodes(
    list: ComponentInstance[],
    parentPath: string[],
    stack: Set<string>,
    isRoot: boolean,
  ): JSX.Element[] {
    return list.map((c) => {
      const path = [...parentPath, c.id];
      const key = pathKey(path);
      const isSubAsm = c.partPath.endsWith('.ziasm');
      const partFileName = c.partPath.split('/').pop()!.replace(/\.ziasm$|\.zipt$/, '');
      const child = isSubAsm ? subAsmDocs[c.partPath] : undefined;
      const childCount = child?.components.length ?? 0;
      const isExpanded = expanded.has(key);
      const isCycle = isSubAsm && stack.has(c.partPath);
      const isGrounded = isRoot && doc.groundedComponentPaths.some((p) => p.length === 1 && p[0] === c.id);
      const myConstraints = isRoot
        ? doc.constraints.filter(
            (k) =>
              (k.refA as any).componentPath?.[0] === c.id ||
              (k.refB as any).componentPath?.[0] === c.id,
          )
        : [];
      return (
        <li key={key} className="pl-3">
          <div className="flex items-center gap-1">
            {isSubAsm ? (
              <button
                type="button"
                aria-label={`expand ${c.id}`}
                onClick={() => useAppStore.getState().toggleSubAsmExpanded(key)}
                style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', padding: 0, width: 14 }}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            ) : (
              <span style={{ width: 14, display: 'inline-block' }} />
            )}
            <span
              className="cursor-pointer hover:text-white"
              onClick={() => useAppStore.getState().selectComponentPaths([path])}
              onDoubleClick={() => {
                if (isRoot) {
                  useAppStore.getState().openEditComponentDialog(c.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isSubAsm) {
                  // Right-click on a sub-asm opens the underlying .ziasm in standalone (Inventor convention).
                  if (window.confirm(t('dialog.openStandalone', { name: partFileName }))) {
                    OpenProjectFileCommand(c.partPath);
                  }
                } else {
                  // Right-click on a leaf opens an Override color dialog (minimal: prompt for hex).
                  const hex = window.prompt(t('dialog.overrideColor'));
                  if (hex === null) return;
                  const trimmed = hex.trim();
                  void new SetComponentColorOverrideCommand({
                    path,
                    color: trimmed === '' ? null : { kind: 'hex', hex: trimmed },
                  }).apply();
                }
              }}
            >
              {isGrounded ? '⛓ ' : ''}{c.id} — {partFileName}
              {isSubAsm && <span style={{ color: '#888' }}> ({childCount} components)</span>}
              {c.flexible && <span style={{ marginLeft: 6, color: '#fbbf24' }}>{t('common.flexible')}</span>}
              {isCycle && <span style={{ marginLeft: 6, color: '#f87171' }}>{t('common.cycle')}</span>}
            </span>
          </div>
          {myConstraints.length > 0 && (
            <ul className="pl-4 space-y-0.5">
              {myConstraints.map((k) => {
                const isSuppressed = k.suppressed;
                const isSelected = selectedConstraintId === k.id;
                return (
                  <li
                    key={k.id}
                    style={{
                      opacity: isSuppressed ? 0.4 : 1,
                      textDecoration: isSuppressed ? 'line-through' : 'none',
                      background: isSelected ? '#334' : undefined,
                      cursor: 'pointer',
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      useAppStore.getState().selectConstraint(k.id);
                    }}
                    onDoubleClick={() => useAppStore.getState().openEditConstraintDialog(k.id)}
                  >
                    {constraintLabel(k.kind)}
                  </li>
                );
              })}
            </ul>
          )}
          {isSubAsm && isExpanded && child && !isCycle && (
            <ul className="pl-4 space-y-0.5">
              {renderNodes(child.components, path, new Set([...stack, c.partPath]), false)}
            </ul>
          )}
        </li>
      );
    });
  }

  return <>{renderNodes(components, [], new Set<string>(), true)}</>;
}


function AssemblyModePane({ part: _part, partInfo, showToast }: { part: PartDocument | null; partInfo: Map<string, PartInfo>; showToast?: ((message: string) => void) | undefined }): JSX.Element {
  const { t } = useTranslation();
  const activeDoc = useAppStore((s) => s.activeDocument);
  const bomTabActive = useAppStore((s) => s.bomTabActive);
  const cutListTabActive = useAppStore((s) => s.cutListTabActive);
  const nestingTabActive = useAppStore((s) => s.nestingTabActive);
  const cutListResult = useCutListResult();
  const connectorRows = useConnectorBomResult();
  const { warmCache } = useCutListCacheContext();

  // Warm the panel-spec cache whenever the Cut List tab becomes active so
  // production users see real rows (not an empty list) without needing to
  // call the dev hook manually.
  useEffect(() => {
    if (cutListTabActive) {
      void warmCache();
    }
  }, [cutListTabActive, warmCache]);

  const asm = (activeDoc as { kind: 'assembly'; document: AssemblyDocument }).document;
  const selectedConstraintId = useAppStore.getState().selectedConstraintId;

  const constraintLabel = (kind: string) => {
    if (kind === 'mate') return 'Mate';
    if (kind === 'flush') return 'Flush';
    if (kind === 'angle') return 'Angle';
    if (kind === 'insert') return 'Insert';
    return kind;
  };

  const setBomTabActive = useAppStore.getState().setBomTabActive;
  const tabStrip = (
    <div className="flex gap-1 mb-1 border-b border-shell-border" role="tablist">
      <button
        type="button"
        aria-label={t('aria.assembly_tab')}
        onClick={() => { setBomTabActive(false); useAppStore.getState().setCutListTabActive(false); useAppStore.getState().setNestingTabActive(false); }}
        className={`px-2 py-0.5 text-xs ${!bomTabActive && !cutListTabActive && !nestingTabActive ? 'bg-shell-panel text-white' : 'text-neutral-400'}`}
      >
        {t('tab.assembly')}
      </button>
      <button
        type="button"
        aria-label={t('aria.bom_tab')}
        onClick={() => setBomTabActive(true)}
        className={`px-2 py-0.5 text-xs ${bomTabActive ? 'bg-shell-panel text-white' : 'text-neutral-400'}`}
      >
        {t('tab.bom')}
      </button>
      <button
        type="button"
        aria-label={t('aria.cut_list_tab')}
        onClick={() => void new OpenCutListTabCommand().apply()}
        className={`px-2 py-0.5 text-xs ${cutListTabActive ? 'bg-shell-panel text-white' : 'text-neutral-400'}`}
      >
        {t('tab.cut_list')}
      </button>
      <button
        type="button"
        aria-label={t('aria.nesting_tab')}
        onClick={() => void new OpenNestingTabCommand({ diagnostics: cutListResult.diagnostics, showToast }).apply()}
        className={`px-2 py-0.5 text-xs ${nestingTabActive ? 'bg-shell-panel text-white' : 'text-neutral-400'}`}
      >
        {t('tab.nesting')}
      </button>
    </div>
  );

  if (nestingTabActive) {
    return (
      <div className="px-3 py-2 text-xs text-neutral-200" data-testid="browser-pane">
        {tabStrip}
        <NestingTab />
      </div>
    );
  }

  if (cutListTabActive) {
    const hwCache = buildHardwareCache(asm, useAppStore.getState().subAssemblyDocs);
    const hardwareRows = aggregateHardwareRecursive(asm, hwCache, [...resolveHardwareCatalog(asm)]).rows;
    return (
      <div className="px-3 py-2 text-xs text-neutral-200" data-testid="browser-pane">
        {tabStrip}
        <CutListTable
          result={cutListResult}
          onSelectRow={(ids) => useAppStore.getState().selectComponents(ids)}
          onEditItemNumber={(k, n) => void new SetCutListItemNumberCommand({ rowKey: k, n }).apply()}
          onExportCsv={() => void new ExportCutListCsvCommand({ result: cutListResult, hardwareRows, connectorRows, suggestedName: `${asm.name}-cutlist.csv` }).apply()}
        />
        <HardwareTable rows={hardwareRows} />
        <ConnectorBomTable rows={connectorRows} />
      </div>
    );
  }

  if (bomTabActive) {
    return (
      <div className="px-3 py-2 text-xs text-neutral-200" data-testid="browser-pane">
        {tabStrip}
        <BomTable partInfo={partInfo} />
      </div>
    );
  }

  return (
    <div className="px-3 py-2 text-xs text-neutral-200" data-testid="browser-pane">
      {tabStrip}
      <div className="font-semibold mb-1">{t('browser.assembly_label', { name: asm.name })}</div>
      <ul className="space-y-0.5">
        <li className="pl-3">{t('browser.origin')}</li>
        <li className="pl-3">{t('browser.components_count', { count: asm.components.length })}</li>
        {renderAssemblyTree({
          components: asm.components,
          doc: asm,
          constraintLabel,
          selectedConstraintId,
        })}
      </ul>
    </div>
  );
}

export default function BrowserPane({ part, sketchPicker, partInfo = new Map(), showToast }: Props) {
  const { t } = useTranslation();
  const setSelectedFeature = useAppStore((s) => s.setSelectedFeature);
  const featureErrors = useAppStore((s) => s.featureErrors);
  const activeDoc = useAppStore((s) => s.activeDocument);

  if (activeDoc?.kind === 'drawing') {
    return <DrawingTreePane />;
  }
  if (activeDoc?.kind === 'assembly') {
    return <AssemblyModePane part={part} partInfo={partInfo} showToast={showToast} />;
  }

  if (!part) {
    return <div className="px-3 py-2 text-xs text-neutral-500">{t('browser.no_part_open')}</div>;
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
            <summary className="cursor-pointer">{t('browser.origin')}</summary>
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
          if (f.kind === 'panel') {
            const panel = f as PanelFeature;
            return (
              <li
                key={f.id}
                className="pl-3 cursor-pointer hover:text-white flex items-center gap-1"
                data-panel-feature-id={f.id}
                style={{
                  opacity: panel.suppressed ? 0.4 : 1,
                  textDecoration: panel.suppressed ? 'line-through' : 'none',
                }}
                onDoubleClick={() => {
                  void new EditPanelFeatureCommand(panel).apply();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const action = window.prompt(t('dialog.panelActions'));
                  if (action === null) return;
                  const cur = useAppStore.getState().activePart;
                  if (!cur) return;
                  if (action.trim().toLowerCase() === 'delete') {
                    const tree = cur.featureTree.filter((x) => x.id !== panel.id);
                    useAppStore.getState().setActivePart({ ...cur, featureTree: tree });
                  } else if (action.trim().toLowerCase() === 'suppress') {
                    const tree = cur.featureTree.map((x) =>
                      x.id === panel.id && x.kind === 'panel'
                        ? ({ ...(x as PanelFeature), suppressed: !(x as PanelFeature).suppressed } as PanelFeature)
                        : x,
                    );
                    useAppStore.getState().setActivePart({ ...cur, featureTree: tree });
                  }
                }}
              >
                <PanelIcon width={12} height={12} />
                Panel
                {renderErrorBadge(f.id)}
              </li>
            );
          }
          if (f.kind === 'imported') {
            return (
              <li
                key={f.id}
                className="pl-3 hover:text-white"
                data-imported="true"
              >
                ▸ Imported ({f.sourceStep})
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
        <li className="pl-3 text-neutral-500">{t('browser.end_of_part')}</li>
      </ul>
    </div>
  );
}
