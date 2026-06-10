import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { OpenPlaceComponentDialogCommand } from '../../commands/OpenPlaceComponentDialogCommand';
import { OpenEditComponentDialogCommand } from '../../commands/OpenEditComponentDialogCommand';
import { DeleteComponentCommand } from '../../commands/DeleteComponentCommand';
import { OpenPlaceConstraintDialogCommand } from '../../commands/OpenPlaceConstraintDialogCommand';
import { OpenEditAssemblyConstraintDialogCommand } from '../../commands/OpenEditAssemblyConstraintDialogCommand';
import { DeleteAssemblyConstraintCommand } from '../../commands/DeleteAssemblyConstraintCommand';
import { ToggleConstraintSuppressionCommand } from '../../commands/ToggleConstraintSuppressionCommand';
import { OpenBomTabCommand } from '../../commands/OpenBomTabCommand';
import { RenumberBomCommand } from '../../commands/RenumberBomCommand';
import type { PartInfo } from '@zilventor/shared';
import { pickFile } from '../fsaFallback';
import { ComponentPatternDialog } from '../ComponentPatternDialog';
import { MirrorComponentDialog } from '../MirrorComponentDialog';
import { CreateComponentPatternCommand } from '../../commands/CreateComponentPatternCommand';
import { MirrorComponentCommand } from '../../commands/MirrorComponentCommand';

const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11, marginRight: 4,
};

type Props = { partInfo?: Map<string, PartInfo> };

export function AssemblyTab({ partInfo }: Props = {}): JSX.Element {
  const { t } = useTranslation();
  const selectedId = useAppStore((s) => {
    const p = s.selectedComponentPaths[0];
    return p ? p[p.length - 1] ?? null : null;
  });
  const hasAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');
  const selectedConstraintId = useAppStore((s) => s.selectedConstraintId);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const selectedConstraint = activeAssembly?.constraints.find((c) => c.id === selectedConstraintId) ?? null;
  const isSuppressed = selectedConstraint?.suppressed ?? false;
  const componentPatternDialogOpen = useAppStore((s) => s.componentPatternDialogOpen);
  const mirrorComponentDialogOpen = useAppStore((s) => s.mirrorComponentDialogOpen);

  const handleInsertFromStep = async () => {
    const { kernel, bus } = useAppStore.getState();
    if (!kernel) return;
    try {
      const file = await pickFile([
        { description: 'STEP file', accept: { 'application/step': ['.step', '.stp'] } },
        { description: 'ZIP archive (with STEP inside)', accept: { 'application/zip': ['.zip'] } },
      ]);
      if (!file) return;

      // ZIP branch: extract first STEP entry
      if (/\.zip$/i.test(file.name)) {
        const { extractStepFromZip } = await import('../../import/extractStepFromZip');
        const zipBytes = new Uint8Array(await file.arrayBuffer());
        const extracted = extractStepFromZip(zipBytes);
        if (!extracted) {
          useAppStore.getState().setStatus(
            i18n.t('status.insertStepFailed', { error: 'No STEP/STP file found in archive' }),
          );
          return;
        }
        const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
        const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
        const opfs = await Opfs.forNavigator();
        const cmd = new ImportStepAsComponentCommand({ stepBytes: extracted.stepBytes, fileName: extracted.fileName, kernel, opfs });
        await bus.execute(cmd);
        return;
      }

      const stepBytes = await file.arrayBuffer();
      const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
      const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
      const opfs = await Opfs.forNavigator();
      const cmd = new ImportStepAsComponentCommand({ stepBytes, fileName: file.name, kernel, opfs });
      await bus.execute(cmd);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      useAppStore.getState().setStatus(i18n.t('status.insertStepFailed', { error: (e as Error).message }));
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: 4 }}>
      <div style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{t('tab.asm.component')}</div>
        <button
          aria-label={t('tab.asm.place')}
          disabled={!hasAssembly}
          onClick={() => OpenPlaceComponentDialogCommand()}
          style={btn}
        >
          {t('tab.asm.place')}
        </button>
        <button
          aria-label={t('tab.asm.insertFromStep')}
          disabled={!hasAssembly}
          onClick={handleInsertFromStep}
          style={btn}
        >
          {t('tab.asm.insertFromStep')}
        </button>
        <button
          aria-label={t('common.edit')}
          disabled={!selectedId}
          onClick={() => selectedId && OpenEditComponentDialogCommand(selectedId)}
          style={btn}
        >
          {t('common.edit')}
        </button>
        <button
          aria-label={t('common.delete')}
          disabled={!selectedId}
          onClick={async () => {
            if (!selectedId) return;
            const cmd = new DeleteComponentCommand({ id: selectedId });
            await cmd.apply();
          }}
          style={btn}
        >
          {t('common.delete')}
        </button>
      </div>
      <div style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{t('tab.asm.pattern')}</div>
        <button
          aria-label={t('tab.asm.rectPattern')}
          disabled={!hasAssembly}
          onClick={() => useAppStore.getState().setComponentPatternDialogOpen(true)}
          style={btn}
        >
          {t('tab.asm.rectPattern')}
        </button>
        <button
          aria-label={t('tab.asm.mirror')}
          disabled={!hasAssembly}
          onClick={() => useAppStore.getState().setMirrorComponentDialogOpen(true)}
          style={btn}
        >
          {t('tab.asm.mirror')}
        </button>
      </div>
      <div style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{t('tab.asm.constraint')}</div>
        <button
          aria-label={t('dialog.placeConstraint.mate')}
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('mate')}
          style={btn}
        >
          {t('dialog.placeConstraint.mate')}
        </button>
        <button
          aria-label={t('dialog.placeConstraint.flush')}
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('flush')}
          style={btn}
        >
          {t('dialog.placeConstraint.flush')}
        </button>
        <button
          aria-label={t('dialog.placeConstraint.angle')}
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('angle')}
          style={btn}
        >
          {t('dialog.placeConstraint.angle')}
        </button>
        <button
          aria-label={t('dialog.placeConstraint.insert')}
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('insert')}
          style={btn}
        >
          {t('dialog.placeConstraint.insert')}
        </button>
        <button
          aria-label={t('tab.asm.editConstraint')}
          disabled={!selectedConstraintId}
          onClick={() => selectedConstraintId && OpenEditAssemblyConstraintDialogCommand(selectedConstraintId)}
          style={btn}
        >
          {t('tab.asm.editConstraint')}
        </button>
        <button
          aria-label={t('tab.asm.deleteConstraint')}
          disabled={!selectedConstraintId}
          onClick={async () => {
            if (!selectedConstraintId) return;
            const cmd = new DeleteAssemblyConstraintCommand({ id: selectedConstraintId });
            await cmd.apply();
          }}
          style={btn}
        >
          {t('tab.asm.deleteConstraint')}
        </button>
        <button
          aria-label={isSuppressed ? t('tab.asm.unsuppress') : t('tab.asm.suppress')}
          disabled={!selectedConstraintId}
          onClick={async () => {
            if (!selectedConstraintId) return;
            const cmd = new ToggleConstraintSuppressionCommand({ id: selectedConstraintId });
            await cmd.apply();
          }}
          style={btn}
        >
          {isSuppressed ? t('tab.asm.unsuppress') : t('tab.asm.suppress')}
        </button>
      </div>
      <div aria-label={t('tab.asm.bomPanel')} style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{t('tab.asm.bom')}</div>
        <button
          aria-label={t('tab.asm.bom')}
          disabled={!hasAssembly}
          onClick={async () => {
            const cmd = new OpenBomTabCommand();
            await cmd.apply();
          }}
          style={btn}
        >
          {t('tab.asm.bom')}
        </button>
        <button
          aria-label={t('tab.asm.renumber')}
          disabled={!hasAssembly}
          onClick={async () => {
            const cmd = new RenumberBomCommand({ partInfo: partInfo ?? new Map() });
            await cmd.apply();
          }}
          style={btn}
        >
          {t('tab.asm.renumber')}
        </button>
      </div>
      {componentPatternDialogOpen && activeAssembly && (
        <ComponentPatternDialog
          components={activeAssembly.components.map((c) => ({
            id: c.id,
            label: c.partPath.replace(/\.zipt$|\.ziasm$/, ''),
          }))}
          onCancel={() => useAppStore.getState().setComponentPatternDialogOpen(false)}
          onCommit={async (v) => {
            useAppStore.getState().setComponentPatternDialogOpen(false);
            const { bus } = useAppStore.getState();
            const cmd = new CreateComponentPatternCommand({
              sourceInstanceId: v.sourceComponentId,
              dir1: v.dir1, count1: v.count1, spacing1: v.spacing1,
              dir2: v.dir2, count2: v.count2, spacing2: v.spacing2,
            });
            await bus.execute(cmd);
          }}
        />
      )}
      {mirrorComponentDialogOpen && activeAssembly && (
        <MirrorComponentDialog
          components={activeAssembly.components.map((c) => ({
            id: c.id,
            label: c.partPath.replace(/\.zipt$|\.ziasm$/, ''),
          }))}
          onCancel={() => useAppStore.getState().setMirrorComponentDialogOpen(false)}
          onCommit={async (v) => {
            useAppStore.getState().setMirrorComponentDialogOpen(false);
            const { kernel, bus } = useAppStore.getState();
            if (!kernel) return;
            const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
            const opfs = await Opfs.forNavigator();
            // Snapshot activeAssembly at commit time (not stale closure)
            const asm = useAppStore.getState().activeAssembly;
            const srcComp = asm?.components.find((c) => c.id === v.sourceComponentId);
            if (!srcComp) return;
            // Load source part bytes to get its kernel-registered part UUID
            const srcBytes = await opfs.read(srcComp.partPath);
            const sourcePartKernelId = await kernel.loadFromBytes(srcBytes);
            const cmd = new MirrorComponentCommand({
              sourceInstanceId: v.sourceComponentId,
              sourcePartKernelId,
              plane: v.plane,
              kernel,
              opfs,
            });
            await bus.execute(cmd);
          }}
        />
      )}
    </div>
  );
}
