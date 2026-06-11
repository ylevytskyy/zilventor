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
import { AddDoorCommand } from '../../commands/AddDoorCommand';
import { AddDrawerBankCommand } from '../../commands/AddDrawerBankCommand';
import { AddDrawerHandlesCommand } from '../../commands/AddDrawerHandlesCommand';
import { GenerateShelfPinBoresCommand } from '../../commands/GenerateShelfPinBoresCommand';
import { AddManualShelfPinBoresCommand } from '../../commands/AddManualShelfPinBoresCommand';
import { LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';
import { useCutListResult } from '../useCutListResult';
import { useBoringResult } from '../useBoringResult';
import { useConnectorBomResult } from '../useConnectorBomResult';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export default function FurnitureTab() {
  const { t } = useTranslation();
  const activePart = useAppStore((s) => s.activePart);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const disabled = !activePart && !activeAssembly;
  const cabinetDisabled = !activeAssembly;
  const cutListResult = useCutListResult();
  const boringResult = useBoringResult();
  const connectorRows = useConnectorBomResult();
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

  /**
   * Resolve a ComponentPath to its partPath by looking up in activeAssembly + subAssemblyDocs.
   * For the присадка use-case the user clicks a top-level cabinet .ziasm or a side panel within it.
   * Addendum §3: this is the resolvePartPath arg passed to beginOneComponentPick.
   */
  const resolvePartPath = (path: ComponentPath): string => {
    const state = useAppStore.getState();
    // Try top-level assembly first.
    const topComp = state.activeAssembly?.components.find((c) => c.id === path[path.length - 1]);
    if (topComp) return topComp.partPath;
    // Try sub-assembly docs (cabinet's inner components).
    for (const doc of Object.values(state.subAssemblyDocs)) {
      const inner = doc.components.find((c) => c.id === path[path.length - 1]);
      if (inner) return inner.partPath;
    }
    // Fallback: treat the leaf id as a direct path (should not happen in practice).
    return String(path[path.length - 1]);
  };

  /**
   * Addendum §3: calls viewport.beginOneComponentPick(resolvePartPath, onPick) with 2 args,
   * stores the returned handle via setOneComponentPickHandle(handle).
   * App.tsx's pointer handler reads oneComponentPickHandle and feeds .pick(clientX, clientY).
   * Addendum §4: passes cabinetPath only — AddDoorCommand derives dims from the unpacked .ziasm.
   */
  const handleAddDoor = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setAddDoorDialog({
        cabinetPath,
        onSubmit: async (p) => {
          const opfs = await Opfs.forNavigator();
          // Addendum §4: pass cabinet as zeros — AddDoorCommand.apply() derives real dims.
          await useAppStore.getState().bus.execute(
            new AddDoorCommand({
              cabinetPath,
              params: {
                cabinet: { width: 0, height: 0, depth: 0, Tc: 0, toekickHeight: 0 },
                count: p.count,
                overlay: p.overlay,
                hingeSide: p.hingeSide,
                thickness: p.thickness,
                reveal: p.reveal,
                clearance: p.clearance,
                centerReveal: p.centerReveal,
              },
              opfs,
              store: useAppStore,
            }),
          );
        },
        onCancel: () => useAppStore.getState().setAddDoorDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };

  /**
   * Slice-4: "Add Drawers" button — follows the door callback-object pattern (§14.8).
   * Picks a cabinet via beginOneComponentPick, then sets addDrawerBankDialog with the
   * cabinetPath and onSubmit/onCancel callbacks.
   */
  const handleAddDrawers = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setAddDrawerBankDialog({
        cabinetPath,
        onSubmit: async (p) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddDrawerBankCommand({
              cabinetPath,
              params: {
                count: p.count,
                overlay: p.overlay,
                thickness: p.thickness,
              },
              opfs,
              store: useAppStore,
            }),
          );
        },
        onCancel: () => useAppStore.getState().setAddDrawerBankDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };

  /**
   * Slice-6: "Add Handles" button — mirrors the Add Drawers flow (PC-8).
   * Picks a cabinet via beginOneComponentPick, then sets addDrawerHandleDialog with
   * cabinetPath, onSubmit (sources opfs same way as Add Drawers), and onCancel.
   */
  const handleAddHandles = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setAddDrawerHandleDialog({
        cabinetPath,
        onSubmit: async (cc) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddDrawerHandlesCommand({
              cabinetPath,
              cc,
              opfs,
              store: useAppStore,
            }),
          );
        },
        onCancel: () => useAppStore.getState().setAddDrawerHandleDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };

  const handleSystem32Auto = () => {
    useAppStore.getState().setShelfPinDialog({
      mode: 'auto',
      onSubmit: async (params) => {
        const opfs = await Opfs.forNavigator();
        await useAppStore.getState().bus.execute(
          new GenerateShelfPinBoresCommand({ params, opfs, store: useAppStore }),
        );
      },
      onCancel: () => useAppStore.getState().setShelfPinDialog(null),
    });
  };

  /**
   * Addendum §1: the default face comes from LEFT_SIDE_INNER_FACE / RIGHT_SIDE_INNER_FACE
   * imported from prisadkaFaceConventions (Phase 0 output). NOT hardcoded literals.
   */
  const handleSystem32Manual = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (panelPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      // Derive the default face from the component's role (addendum §1).
      const state = useAppStore.getState();
      const allComponents = [
        ...(state.activeAssembly?.components ?? []),
        ...Object.values(state.subAssemblyDocs).flatMap((d) => d.components),
      ];
      const comp = allComponents.find((c) => c.partPath === panelPath);
      // Map component role to the canonical inner broad face from the shared conventions module.
      // RIGHT_SIDE_INNER_FACE / LEFT_SIDE_INNER_FACE are proven by Phase 0.
      const defaultFace: 'Top' | 'Bottom' =
        comp?.role === 'rightSide' ? RIGHT_SIDE_INNER_FACE : LEFT_SIDE_INNER_FACE;
      useAppStore.getState().setShelfPinDialog({
        mode: 'manual',
        panelPath,
        face: defaultFace,
        onSubmit: async (params) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddManualShelfPinBoresCommand({
              panelPath,
              face: defaultFace,
              params,
              opfs,
              store: useAppStore,
            }),
          );
        },
        onCancel: () => useAppStore.getState().setShelfPinDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
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
      <div aria-label={t('ribbon.furniture.cabinetsPanel')}>
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
      <div aria-label={t('ribbon.furniture.hardwarePanel')}>
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
      <div aria-label={t('ribbon.furniture.cutListPanel')}>
        <RibbonPanel title={t('ribbon.furniture.cutList')}>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new OpenCutListTabCommand().apply()}>{t('ribbon.furniture.cutList')}</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new RenumberCutListCommand({ result: cutListResult }).apply()}>{t('tab.asm.renumber')}</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new ExportCutListCsvCommand({
              result: cutListResult,
              connectorRows,
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
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddDoor(); }}
            aria-label={t('ribbon.furniture.addDoor')}
          >
            {t('ribbon.furniture.addDoor')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddDrawers(); }}
            aria-label={t('aria.add_drawers')}
          >
            {t('ribbon.furniture.addDrawers')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddHandles(); }}
            aria-label={t('aria.add_handles', 'Add Handles')}
          >
            {t('ribbon.furniture.addHandles', 'Add Handles')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleSystem32Auto(); }}
            aria-label={t('ribbon.furniture.system32Auto')}
          >
            {t('ribbon.furniture.system32Auto')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleSystem32Manual(); }}
            aria-label={t('ribbon.furniture.system32Manual')}
          >
            {t('ribbon.furniture.system32Manual')}
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
