import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { isImportedPart } from '@zilventor/shared';
import { CreatePartCommand } from '../../commands/CreatePartCommand';
import { AddExtrusionCommand } from '../../commands/AddExtrusionCommand';
import { OpenHoleDialogCommand } from '../../commands/OpenHoleDialogCommand';
import { OpenSweepDialogCommand } from '../../commands/OpenSweepDialogCommand';
import { OpenWorkPlaneDialogCommand } from '../../commands/OpenWorkPlaneDialogCommand';
import { OpenWorkAxisDialogCommand } from '../../commands/OpenWorkAxisDialogCommand';
import { OpenWorkPointDialogCommand } from '../../commands/OpenWorkPointDialogCommand';
import ExtrudeDialog, { type ExtrudeDialogValue } from '../ExtrudeDialog';

export default function ModelTab() {
  const { t } = useTranslation();
  const activePart = useAppStore((s) => s.activePart);
  const [extrudeOpen, setExtrudeOpen] = useState(false);

  const handleNewPart = async () => {
    const { kernel, bus, setActivePart } = useAppStore.getState();
    if (!kernel) return;
    await bus.execute(new CreatePartCommand({ kernel, store: { setActivePart }, name: 'Part1' }));
  };

  const hasSketch = !!activePart?.featureTree.some((f) => f.kind === 'sketch');
  const hasRunningBody = !!activePart?.featureTree.some(
    (f) => f.kind === 'extrude' || f.kind === 'revolve'
  );
  const readOnly = activePart ? isImportedPart(activePart) : false;
  const readOnlyTip = readOnly
    ? 'This part was imported from Inventor and is read-only. Re-author parametrically by creating a new part.'
    : undefined;

  const isExplodable = useAppStore((s) =>
    s.activeDocument?.kind === 'part' &&
    (s.activePart?.featureTree.some((f) => f.kind === 'imported') ?? false)
  );

  const handleExplode = async () => {
    const { kernel, bus } = useAppStore.getState();
    if (!kernel) return;
    try {
      const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
      const opfs = await Opfs.forNavigator();
      const { ExplodeIntoAssemblyCommand } = await import('../../commands/ExplodeIntoAssemblyCommand');
      await bus.execute(new ExplodeIntoAssemblyCommand({ kernel, opfs }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      useAppStore.getState().setStatus(i18n.t('status.explodeFailed', { error: (e as Error).message }));
    }
  };

  const handleExtrudeCommit = async (v: ExtrudeDialogValue) => {
    const { kernel, bus, activePart: part, setActivePart } = useAppStore.getState();
    if (!kernel || !part) return;
    const d = Number(v.distance);
    if (!Number.isFinite(d) || d <= 0) return;
    const lastSketch = [...part.featureTree].reverse().find((f) => f.kind === 'sketch');
    if (!lastSketch) return;
    await bus.execute(new AddExtrusionCommand({
      kernel,
      store: { activePart: part, setActivePart },
      parameter: { name: 'd1', expression: String(d), value: d, unit: 'mm' },
      feature: {
        kind: 'extrude',
        id: `e${Date.now()}`,
        sketchRef: lastSketch.id,
        distanceParam: 'd1',
        direction: 'forward',
        operation: v.operation,
      },
    }));
    setExtrudeOpen(false);
  };

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title={t('ribbon.model.create')}>
        <button className="text-xs hover:text-white" onClick={handleNewPart}>{t('menu.file.newPart')}</button>
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!hasSketch || readOnly} title={readOnlyTip} onClick={() => setExtrudeOpen(true)}>{t('ribbon.model.extrude')}</button>
        <button className="text-xs hover:text-white disabled:text-neutral-500" disabled={!hasSketch || readOnly} title={readOnlyTip} onClick={() => useAppStore.getState().setRevolveDialogOpen(true)}>{t('ribbon.model.revolve')}</button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasSketch || readOnly}
          onClick={() => OpenSweepDialogCommand()}
          aria-label={t('ribbon.model.sweep')}
          title={readOnly ? readOnlyTip : t('ribbon.model.sweep')}
        >
          {t('ribbon.model.sweep')}
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          aria-label={t('ribbon.model.explode')}
          disabled={!isExplodable}
          onClick={() => { void handleExplode(); }}
        >
          {t('ribbon.model.explode')}
        </button>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.model.workFeatures')}>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!activePart || readOnly}
          onClick={() => OpenWorkPlaneDialogCommand()}
          aria-label={t('ribbon.model.plane')}
          title={readOnly ? readOnlyTip : t('ribbon.model.plane')}
        >
          {t('ribbon.model.plane')}
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!activePart || readOnly}
          onClick={() => OpenWorkAxisDialogCommand()}
          aria-label={t('ribbon.model.axis')}
          title={readOnly ? readOnlyTip : t('ribbon.model.axis')}
        >
          {t('ribbon.model.axis')}
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!activePart || readOnly}
          onClick={() => OpenWorkPointDialogCommand()}
          aria-label={t('ribbon.model.point')}
          title={readOnly ? readOnlyTip : t('ribbon.model.point')}
        >
          {t('ribbon.model.point')}
        </button>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.model.modify')}>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setFilletDialogOpen(true)}
        >
          {t('ribbon.model.fillet')}
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setChamferDialogOpen(true)}
        >
          {t('ribbon.model.chamfer')}
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setShellDialogOpen(true)}
        >
          {t('ribbon.model.shell')}
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          onClick={() => OpenHoleDialogCommand()}
          title={readOnly ? readOnlyTip : t('ribbon.model.hole')}
          aria-label={t('ribbon.model.hole')}
        >
          {t('ribbon.model.hole')}
        </button>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.model.pattern')}>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setLinearPatternDialogOpen(true)}
        >
          {t('ribbon.model.linearPattern')}
        </button>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500"
          disabled={!hasRunningBody || readOnly}
          title={readOnlyTip}
          onClick={() => useAppStore.getState().setMirrorDialogOpen(true)}
        >
          {t('ribbon.model.mirror')}
        </button>
      </RibbonPanel>
      <RibbonPanel title={t('ribbon.model.parameters')}>
        <button className="text-xs hover:text-white" onClick={() => useAppStore.getState().setParametersPanelOpen(true)}>{t('ribbon.model.parametersBtn')}</button>
      </RibbonPanel>
      {extrudeOpen && (
        <ExtrudeDialog
          hasRunningBody={hasRunningBody}
          onCommit={(v) => { void handleExtrudeCommit(v); }}
          onCancel={() => setExtrudeOpen(false)}
        />
      )}
    </div>
  );
}
