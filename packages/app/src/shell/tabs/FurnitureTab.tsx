import type { PanelFeature } from '@zilventor/shared';
import { PanelIcon } from '@zilventor/icons';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { OpenPanelDialogCommand } from '../../commands/OpenPanelDialogCommand';
import { AddPanelFeatureCommand } from '../../commands/AddPanelFeatureCommand';
import { CreateAndPlacePanelCommand } from '../../commands/CreateAndPlacePanelCommand';
import { OpenCutListTabCommand } from '../../commands/OpenCutListTabCommand';
import { RenumberCutListCommand } from '../../commands/RenumberCutListCommand';
import { ExportCutListCsvCommand } from '../../commands/ExportCutListCsvCommand';
import { useCutListResult } from '../useCutListResult';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export default function FurnitureTab() {
  const activePart = useAppStore((s) => s.activePart);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const disabled = !activePart && !activeAssembly;
  const cutListResult = useCutListResult();

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
          partName,
          partPath,
          panel,
          partMaterials: state.activeAssembly.materials,
          opfs,
        }).apply();
      }
    };
    await new OpenPanelDialogCommand({ onSubmit }).apply();
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
      <div aria-label="Cut List panel">
        <RibbonPanel title="Cut List">
          <button
            type="button"
            className="text-xs hover:text-white"
            onClick={() => void new OpenCutListTabCommand().apply()}
          >
            Cut List
          </button>
          <button
            type="button"
            className="text-xs hover:text-white"
            onClick={() => void new RenumberCutListCommand({ result: cutListResult }).apply()}
          >
            Renumber
          </button>
          <button
            type="button"
            className="text-xs hover:text-white"
            onClick={() => void new ExportCutListCsvCommand({
              result: cutListResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-cutlist.csv`,
            }).apply()}
          >
            Export CSV
          </button>
        </RibbonPanel>
      </div>
    </div>
  );
}
