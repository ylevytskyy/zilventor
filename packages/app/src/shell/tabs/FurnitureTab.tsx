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
import { ExportBoringCsvCommand } from '../../commands/ExportBoringCsvCommand';
import { useCutListResult } from '../useCutListResult';
import { useBoringResult } from '../useBoringResult';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export default function FurnitureTab() {
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

  const handleGenerateBores = async () => {
    const opfs = await Opfs.forNavigator();
    await useAppStore.getState().bus.execute(
      new GenerateCarcassBoresCommand({
        params: {
          endSetback: 60,
          maxSpacing: 250,
          minCount: 2,
          confirmat: true,
          minifix: false,
          dowel: false,
        },
        opfs,
      }),
    );
  };

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Create">
        <button
          className="text-xs hover:text-white disabled:text-neutral-500 flex items-center gap-1"
          disabled={disabled}
          onClick={() => { void handlePanel(); }}
          aria-label="Panel"
        >
          <PanelIcon width={14} height={14} />
          Panel
        </button>
      </RibbonPanel>
      <div aria-label="Cabinets panel">
        <RibbonPanel title="Cabinets">
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleCabinet(); }}
            aria-label="Base Cabinet"
            title={cabinetDisabled ? 'Open or create an assembly first' : ''}
          >
            Base Cabinet
          </button>
        </RibbonPanel>
      </div>
      <div aria-label="Hardware panel">
        <RibbonPanel title="Hardware">
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleHardware(); }}
            aria-label="Add Hardware"
            title={cabinetDisabled ? 'Open or create an assembly first' : ''}
          >
            Add Hardware
          </button>
        </RibbonPanel>
      </div>
      <div aria-label="Cut List panel">
        <RibbonPanel title="Cut List">
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new OpenCutListTabCommand().apply()}>Cut List</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new RenumberCutListCommand({ result: cutListResult }).apply()}>Renumber</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new ExportCutListCsvCommand({
              result: cutListResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-cutlist.csv`,
            }).apply()}>Export CSV</button>
        </RibbonPanel>
      </div>
      <div aria-label="Присадка panel">
        <RibbonPanel title="Присадка">
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? 'Open or create an assembly first' : ''}
            onClick={() => { void handleGenerateBores(); }}
            aria-label="Generate Присадку"
          >
            Генерувати присадку
          </button>
          <button type="button" className="text-xs hover:text-white"
            aria-pressed={showBores}
            onClick={() => useAppStore.getState().setShowBores(!showBores)}>
            {showBores ? 'Hide Bores' : 'Show Bores'}
          </button>
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly}
            aria-disabled={!activeAssembly}
            onClick={() => void new ExportBoringCsvCommand({
              result: boringResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-boring.csv`,
            }).apply()}>
            Export CSV (Boring)
          </button>
        </RibbonPanel>
      </div>
      <div aria-label="Nesting panel">
        <RibbonPanel title="Nesting">
          <button type="button" className="text-xs hover:text-white"
            onClick={() => { void new OpenNestDialogCommand().apply(); }}>
            Generate Nest
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
            Export PDF
          </button>
        </RibbonPanel>
      </div>
    </div>
  );
}
