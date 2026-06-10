import { useTranslation } from 'react-i18next';
import type { BaseCabinetParams, PanelFeature } from '@zilventor/shared';
import { PanelIcon } from '@zilventor/icons';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { OpenPanelDialogCommand } from '../../commands/OpenPanelDialogCommand';
import { OpenCabinetDialogCommand } from '../../commands/OpenCabinetDialogCommand';
import { OpenHardwareDialogCommand } from '../../commands/OpenHardwareDialogCommand';
import { AddHardwareCommand } from '../../commands/AddHardwareCommand';
import { AddPanelFeatureCommand } from '../../commands/AddPanelFeatureCommand';
import { CreateAndPlacePanelCommand } from '../../commands/CreateAndPlacePanelCommand';
import { CreateCabinetCommand } from '../../commands/CreateCabinetCommand';
import { OpenNestDialogCommand } from '../../commands/OpenNestDialogCommand';
import { OpenCutListTabCommand } from '../../commands/OpenCutListTabCommand';
import { RenumberCutListCommand } from '../../commands/RenumberCutListCommand';
import { ExportCutListCsvCommand } from '../../commands/ExportCutListCsvCommand';
import { ExportNestPdfCommand } from '../../commands/ExportNestPdfCommand';
import { GenerateCarcassBoresCommand } from '../../commands/GenerateCarcassBoresCommand';
import { ClearBoresCommand } from '../../commands/ClearBoresCommand';
import { ExportBoringCsvCommand } from '../../commands/ExportBoringCsvCommand';
import { ExportBoringDxfCommand } from '../../commands/ExportBoringDxfCommand';
import { useCutListResult } from '../useCutListResult';
import { useBoringResult } from '../useBoringResult';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export default function FurnitureTab() {
  const { t } = useTranslation();
  const activePart = useAppStore((s) => s.activePart);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const disabled = !activePart && !activeAssembly;
  const cabinetDisabled = !activeAssembly;
  const cutListResult = useCutListResult();
  const boringResult = useBoringResult();
  const showBores = useAppStore((s) => s.showBores);

  const handlePanel = async () => {
    const onSubmit = async (panel: PanelFeature) => {
      const state = useAppStore.getState();
      if (state.activePart) {
        await new AddPanelFeatureCommand(panel).apply();
      } else if (state.activeAssembly) {
        const opfs = await Opfs.forNavigator();
        const partName = `Panel-${panel.id}`;
        const partPath = `parts/${partName}.zipt`;
        await new CreateAndPlacePanelCommand({
          partName, partPath, panel,
          partMaterials: state.activeAssembly.materials,
          opfs,
        }).apply();
      }
    };
    await new OpenPanelDialogCommand({ onSubmit }).apply();
  };

  const handleCabinet = async () => {
    const onSubmit = async (params: BaseCabinetParams) => {
      const opfs = await Opfs.forNavigator();
      await useAppStore.getState().bus.execute(
        new CreateCabinetCommand({ template: 'baseCabinet', params, opfs }),
      );
    };
    await new OpenCabinetDialogCommand({ template: 'baseCabinet', onSubmit }).apply();
  };

  const handleHardware = async () => {
    const onSubmit = async (skuId: string, qty: number) => {
      const opfs = await Opfs.forNavigator();
      for (let i = 0; i < qty; i++) {
        await useAppStore.getState().bus.execute(
          new AddHardwareCommand({ skuId, opfs }),
        );
      }
    };
    await new OpenHardwareDialogCommand({ onSubmit }).apply();
  };

  const handleGenerateBores = () => {
    useAppStore.getState().setBoringDialog({
      onSubmit: async ({ confirmat, minifix, dowel }) => {
        const opfs = await Opfs.forNavigator();
        const cmd = new GenerateCarcassBoresCommand({
          params: { endSetback: 60, maxSpacing: 250, minCount: 2, confirmat, minifix, dowel },
          opfs,
        });
        // The command self-invalidates bore/geometry caches via boreCacheInvalidator
        // (registered by App.tsx) so bore markers re-render on apply AND undo/redo.
        await useAppStore.getState().bus.execute(cmd);
      },
      onCancel: () => useAppStore.getState().setBoringDialog(null),
    });
  };

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title={t('ribbon.furniture.create')}>
        <button
          className="text-xs hover:text-white disabled:text-neutral-500 flex items-center gap-1"
          disabled={disabled}
          onClick={() => { void handlePanel(); }}
          aria-label={t('ribbon.furniture.panel')}
        >
          <PanelIcon width={14} height={14} />
          {t('ribbon.furniture.panel')}
        </button>
      </RibbonPanel>
      <div aria-label={t('ribbon.furniture.cabinets')}>
        <RibbonPanel title={t('ribbon.furniture.cabinets')}>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleCabinet(); }}
            aria-label={t('ribbon.furniture.baseCabinet')}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
          >
            {t('ribbon.furniture.baseCabinet')}
          </button>
        </RibbonPanel>
      </div>
      <div aria-label={t('ribbon.furniture.hardware')}>
        <RibbonPanel title={t('ribbon.furniture.hardware')}>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleHardware(); }}
            aria-label={t('ribbon.furniture.addHardware')}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
          >
            {t('ribbon.furniture.addHardware')}
          </button>
        </RibbonPanel>
      </div>
      <div aria-label={t('ribbon.furniture.cutList')}>
        <RibbonPanel title={t('ribbon.furniture.cutList')}>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new OpenCutListTabCommand().apply()}>{t('ribbon.furniture.cutList')}</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new RenumberCutListCommand({ result: cutListResult }).apply()}>{t('tab.asm.renumber')}</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new ExportCutListCsvCommand({
              result: cutListResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-cutlist.csv`,
            }).apply()}>{t('ribbon.furniture.exportCsv')}</button>
        </RibbonPanel>
      </div>
      <div aria-label={t('ribbon.furniture.presadka')}>
        <RibbonPanel title={t('ribbon.furniture.presadka')}>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleGenerateBores(); }}
            aria-label={t('ribbon.furniture.generatePresadku')}
          >
            {t('ribbon.furniture.generatePresadku')}
          </button>
          <button type="button" className="text-xs hover:text-white"
            aria-pressed={showBores}
            onClick={() => useAppStore.getState().setShowBores(!showBores)}>
            {showBores ? t('ribbon.furniture.hideBores') : t('ribbon.furniture.showBores')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly}
            aria-disabled={!activeAssembly}
            aria-label={t('ribbon.furniture.clearPresadku')}
            title={!activeAssembly ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => {
              const state = useAppStore.getState();
              const asm = state.activeAssembly;
              if (!asm) return;
              // Clear bores from all panels that currently have a non-empty bores[].
              // Each ClearBoresCommand is undoable independently.
              void (async () => {
                const opfs = await (await import('@zilventor/kernel/src/storage/Opfs')).Opfs.forNavigator();
                const { unpackProject } = await import('@zilventor/kernel/src/storage/ProjectPacker');
                for (const comp of asm.components) {
                  if (!comp.partPath.endsWith('.zipt')) continue;
                  try {
                    const bytes = await opfs.read(comp.partPath);
                    const project = await unpackProject(bytes);
                    const doc = (project.manifest as { document: { bores?: import('@zilventor/shared').BoreOp[] } }).document;
                    if (!doc.bores || doc.bores.length === 0) continue;
                    await state.bus.execute(new ClearBoresCommand({ doc, partPath: comp.partPath, opfs }));
                  } catch {
                    // panel not yet in OPFS (not yet saved) — skip
                  }
                }
              })();
            }}>
            {t('ribbon.furniture.clearPresadku')}
          </button>
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly}
            aria-disabled={!activeAssembly}
            onClick={() => void new ExportBoringCsvCommand({
              result: boringResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-boring.csv`,
            }).apply()}>
            {t('ribbon.furniture.exportBoringCsv')}
          </button>
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly}
            aria-disabled={!activeAssembly}
            onClick={() => void new ExportBoringDxfCommand({
              result: boringResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-boring.dxf`,
            }).apply()}>
            {t('ribbon.furniture.exportBoringDxf')}
          </button>
        </RibbonPanel>
      </div>
      <div aria-label={t('ribbon.furniture.nesting')}>
        <RibbonPanel title={t('ribbon.furniture.nesting')}>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => { void new OpenNestDialogCommand().apply(); }}>
            {t('ribbon.furniture.generateNest')}
          </button>
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly?.nest}
            aria-disabled={!activeAssembly?.nest}
            onClick={async () => {
              if (!activeAssembly?.nest) return;
              await new ExportNestPdfCommand({
                nest: activeAssembly.nest, materials: activeAssembly.materials,
                suggestedName: `${activeAssembly.name}-nest.pdf`,
              }).apply();
            }}>
            {t('ribbon.drawing.exportPdf')}
          </button>
        </RibbonPanel>
      </div>
    </div>
  );
}
