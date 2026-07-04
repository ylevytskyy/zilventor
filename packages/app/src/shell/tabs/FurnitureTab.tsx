import { useTranslation } from 'react-i18next';
import type { BaseCabinetParams, BlindCornerCabinetParams, CornerCabinetParams, DiagonalCornerCabinetParams, PanelFeature } from '@zilventor/shared';
import { PanelIcon } from '@zilventor/icons';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { OpenPanelDialogCommand } from '../../commands/OpenPanelDialogCommand';
import { OpenCabinetDialogCommand } from '../../commands/OpenCabinetDialogCommand';
import { OpenCornerCabinetDialogCommand } from '../../commands/OpenCornerCabinetDialogCommand';
import { OpenBlindCornerCabinetDialogCommand } from '../../commands/OpenBlindCornerCabinetDialogCommand';
import { OpenDiagonalCornerCabinetDialogCommand } from '../../commands/OpenDiagonalCornerCabinetDialogCommand';
import { OpenHardwareDialogCommand } from '../../commands/OpenHardwareDialogCommand';
import { AddHardwareCommand } from '../../commands/AddHardwareCommand';
import { AddPanelFeatureCommand } from '../../commands/AddPanelFeatureCommand';
import { CreateAndPlacePanelCommand } from '../../commands/CreateAndPlacePanelCommand';
import { CreateCabinetCommand } from '../../commands/CreateCabinetCommand';
import { OpenNestDialogCommand } from '../../commands/OpenNestDialogCommand';
import { OpenCutListTabCommand } from '../../commands/OpenCutListTabCommand';
import { OpenStatisticsReportTabCommand } from '../../commands/OpenStatisticsReportTabCommand';
import { OpenProductionTabCommand } from '../../commands/OpenProductionTabCommand';
import { ExportPackingSlipPdfCommand } from '../../commands/ExportPackingSlipPdfCommand';
import { buildPackingSlipRows } from '../../production/buildPackingSlipRows';
import { RenumberCutListCommand } from '../../commands/RenumberCutListCommand';
import { ExportCutListCsvCommand } from '../../commands/ExportCutListCsvCommand';
import { ExportNestPdfCommand } from '../../commands/ExportNestPdfCommand';
import { ExportNestDxfCommand } from '../../commands/ExportNestDxfCommand';
import { GenerateCarcassBoresCommand } from '../../commands/GenerateCarcassBoresCommand';
import { ClearBoresCommand } from '../../commands/ClearBoresCommand';
import { ExportBoringCsvCommand } from '../../commands/ExportBoringCsvCommand';
import { ExportBoringDxfCommand } from '../../commands/ExportBoringDxfCommand';
import { ExportPanelManufacturingDxfCommand } from '../../commands/ExportPanelManufacturingDxfCommand';
import { ExportPanelLabelsCommand } from '../../commands/ExportPanelLabelsCommand';
import { usePanelManufacturingInputs } from '../usePanelManufacturingInputs';
import { AddDoorCommand } from '../../commands/AddDoorCommand';
import { AddDrawerBankCommand } from '../../commands/AddDrawerBankCommand';
import { AddLegLevelersCommand } from '../../commands/AddLegLevelersCommand';
import { AddDrawerHandlesCommand } from '../../commands/AddDrawerHandlesCommand';
import { AddFaceFrameCommand } from '../../commands/AddFaceFrameCommand';
import { GenerateShelfPinBoresCommand } from '../../commands/GenerateShelfPinBoresCommand';
import { AddManualShelfPinBoresCommand } from '../../commands/AddManualShelfPinBoresCommand';
import { AddGrooveCommand } from '../../commands/AddGrooveCommand';
import { AddKeyholeSlotCommand } from '../../commands/AddKeyholeSlotCommand';
import { AddTenonMortiseCommand } from '../../commands/AddTenonMortiseCommand';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { TenonMortiseCreateInput } from '@zilventor/shared';
import { inferManualJoint } from '@zilventor/shared';
import { LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';
import { useCutListResult } from '../useCutListResult';
import { useBoringResult } from '../useBoringResult';
import { useConnectorBomResult } from '../useConnectorBomResult';
import { useStatisticsReport } from '../useStatisticsReport';
import { ExportStatisticsCsvCommand } from '../../commands/ExportStatisticsCsvCommand';
import { ExportStatisticsXlsxCommand } from '../../commands/ExportStatisticsXlsxCommand';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { deriveCabinetDims } from '../../commands/cabinetDims';
import { collectBoreDocsForClear } from '../../commands/clearBoresForAssembly';

export default function FurnitureTab({ showToast }: { showToast?: ((message: string) => void) | undefined } = {}) {
  const { t } = useTranslation();
  const activePart = useAppStore((s) => s.activePart);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const disabled = !activePart && !activeAssembly;
  const cabinetDisabled = !activeAssembly;
  const cutListResult = useCutListResult();
  const boringResult = useBoringResult();
  const connectorRows = useConnectorBomResult();
  const statisticsReport = useStatisticsReport();
  const panelManufacturingInputs = usePanelManufacturingInputs();
  const showBores = useAppStore((s) => s.showBores);
  const dxfExportMode = useAppStore((s) => s.dxfExportMode);
  const layerScheme = useAppStore((s) => s.layerScheme);
  const labelTemplate = useAppStore((s) => s.labelTemplate);
  const labelHeaderLine1 = useAppStore((s) => s.labelHeaderLine1);
  const labelHeaderLine2 = useAppStore((s) => s.labelHeaderLine2);
  const labelHeaderPresets = useAppStore((s) => s.labelHeaderPresets);

  const handlePanel = async () => {
    const onSubmit = async (panel: PanelFeature) => {
      const state = useAppStore.getState();
      if (state.activePart) {
        await state.bus.execute(new AddPanelFeatureCommand(panel));
      } else if (state.activeAssembly) {
        const opfs = await Opfs.forNavigator();
        const partName = `Panel-${panel.id}`;
        const partPath = `parts/${partName}.zipt`;
        await state.bus.execute(new CreateAndPlacePanelCommand({
          partName, partPath, panel,
          partMaterials: state.activeAssembly.materials,
          opfs,
        }));
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

  const handleCornerCabinet = async () => {
    const onSubmit = async (params: CornerCabinetParams) => {
      const opfs = await Opfs.forNavigator();
      await useAppStore.getState().bus.execute(
        new CreateCabinetCommand({ template: 'cornerCabinet', params, opfs }),
      );
    };
    await new OpenCornerCabinetDialogCommand({ onSubmit }).apply();
  };

  const handleBlindCornerCabinet = async () => {
    const onSubmit = async (params: BlindCornerCabinetParams) => {
      const opfs = await Opfs.forNavigator();
      await useAppStore.getState().bus.execute(
        new CreateCabinetCommand({ template: 'blindCornerCabinet', params, opfs }),
      );
    };
    await new OpenBlindCornerCabinetDialogCommand({ onSubmit }).apply();
  };

  const handleDiagonalCornerCabinet = async () => {
    const onSubmit = async (params: DiagonalCornerCabinetParams) => {
      const opfs = await Opfs.forNavigator();
      await useAppStore.getState().bus.execute(
        new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params, opfs }),
      );
    };
    await new OpenDiagonalCornerCabinetDialogCommand({ onSubmit }).apply();
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
                style: p.style,
                frameWidth: p.frameWidth,
              },
              ...(p.cupPresetValues ? { cupPresetValues: p.cupPresetValues } : {}),
              ...(p.platePresetValues ? { platePresetValues: p.platePresetValues } : {}),
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
    const handle = viewport.beginOneComponentPick(resolvePartPath, async (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      const opfs = await Opfs.forNavigator();
      const cab = await unpackAssembly(await opfs.read(cabinetPath));
      const raw = await deriveCabinetDims(cab, opfs);
      const openW = raw.width - 2 * raw.Tc;
      const openH = raw.height - raw.toekickHeight - 2 * raw.Tc;
      useAppStore.getState().setAddDrawerBankDialog({
        cabinetPath,
        dims: { openW, openH },
        onSubmit: async (p) => {
          const opfs2 = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddDrawerBankCommand({
              cabinetPath,
              params: {
                count: p.count,
                overlay: p.overlay,
                thickness: p.thickness,
                slideSystem: p.slideSystem,
                ...(p.heights !== undefined ? { heights: p.heights } : {}),
              },
              ...(p.cabinetPresetValues ? { cabinetPresetValues: p.cabinetPresetValues } : {}),
              ...(p.drawerPresetValues ? { drawerPresetValues: p.drawerPresetValues } : {}),
              opfs: opfs2,
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
   * M4-B: "Add Leg Levelers" button — mirrors the Add Drawers flow.
   * Picks a cabinet via beginOneComponentPick, then sets addLegLevelersDialog with
   * cabinetPath, onSubmit (builds AddLegLevelersCommand), and onCancel.
   */
  const handleAddLegLevelers = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setAddLegLevelersDialog({
        cabinetPath,
        onSubmit: async (p) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddLegLevelersCommand({
              cabinetPath,
              params: {
                legsPerRow: p.legsPerRow,
                skuId: p.skuId,
              },
              ...(p.presetValues ? { presetValues: p.presetValues } : {}),
              opfs,
              store: useAppStore,
            }),
          );
        },
        onCancel: () => useAppStore.getState().setAddLegLevelersDialog(null),
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

  /**
   * "Add Face Frame" button — mirrors the Add Drawers flow.
   * Picks a cabinet via beginOneComponentPick, then sets addFaceFrameDialog with
   * cabinetPath, onSubmit (sources opfs same way as Add Drawers), and onCancel.
   */
  const handleAddFaceFrame = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setAddFaceFrameDialog({
        cabinetPath,
        onSubmit: async (p) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddFaceFrameCommand({ cabinetPath, params: p, opfs, store: useAppStore }),
          );
        },
        onCancel: () => useAppStore.getState().setAddFaceFrameDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };

  const handleSystem32Auto = () => {
    useAppStore.getState().setShelfPinDialog({
      mode: 'auto',
      onSubmit: async (params) => {
        const { presetValues, ...shelfPinParams } = params;
        const opfs = await Opfs.forNavigator();
        await useAppStore.getState().bus.execute(
          new GenerateShelfPinBoresCommand({
            params: shelfPinParams,
            ...(presetValues ? { presetValues } : {}),
            opfs,
            store: useAppStore,
          }),
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
          const { presetValues, ...shelfPinParams } = params;
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddManualShelfPinBoresCommand({
              panelPath,
              face: defaultFace,
              params: shelfPinParams,
              ...(presetValues ? { presetValues } : {}),
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

  const handleAddGroove = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (panelPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      const state = useAppStore.getState();
      const allComponents = [
        ...(state.activeAssembly?.components ?? []),
        ...Object.values(state.subAssemblyDocs).flatMap((d) => d.components),
      ];
      const comp = allComponents.find((c) => c.partPath === panelPath);
      const defaultFace: 'Top' | 'Bottom' =
        comp?.role === 'rightSide' ? RIGHT_SIDE_INNER_FACE : LEFT_SIDE_INNER_FACE;
      useAppStore.getState().setGrooveDialog({
        panelPath,
        defaultFace,
        onSubmit: async (spec) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddGrooveCommand({ partPath: panelPath, groove: spec, opfs, store: useAppStore }),
          );
        },
        onCancel: () => useAppStore.getState().setGrooveDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };

  /**
   * Wall-hanger keyhole-slot routing (P16) — mirrors handleAddGroove's picker
   * flow, but the dialog's default face is fixed to 'Bottom' internally (the
   * large rear face; edge faces have no flat-drawing representation), so no
   * defaultFace is threaded through here (unlike Groove's role-derived default).
   */
  const handleAddKeyholeSlot = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (panelPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setKeyholeSlotDialog({
        panelPath,
        onSubmit: async (spec) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddKeyholeSlotCommand({ partPath: panelPath, keyholeSlot: spec, opfs, store: useAppStore }),
          );
        },
        onCancel: () => useAppStore.getState().setKeyholeSlotDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };

  /**
   * AddTenonMortiseCommand silently no-ops when the two picked panels don't form a
   * butt joint (`inferManualJoint` returns null) — it has no return value/result object
   * to signal that. Detect it from the UI side by diffing each panel's featureTree
   * length before/after `bus.execute`, reusing the existing `showToast` mechanism
   * (mirrors ExportBoringDxfCommand/ExportPanelManufacturingDxfCommand's diagnostics
   * toasts) rather than inventing a new feedback channel or modifying the command.
   */
  const tenonMortiseFeatureCount = async (
    opfs: { read(p: string): Promise<Uint8Array> },
    partPath: string,
  ): Promise<number | null> => {
    try {
      const bytes = await opfs.read(partPath);
      const project = await unpackProject(bytes);
      const doc = (project.manifest as { document?: { featureTree?: unknown[] } } | null)?.document;
      return doc?.featureTree?.length ?? 0;
    } catch {
      return null;
    }
  };

  /**
   * Resolves one panel's dims + world-center pose from its .zipt manifest, for
   * `inferManualJoint` — duplicated from AddTenonMortiseCommand.loadPanel's dims
   * resolution + corner-to-center conversion (module-private in both, per this
   * codebase's established panelDimsFromDoc-duplication convention; see
   * AddManualJointBoresCommand/GenerateCarcassBoresCommand/etc.). Returns null
   * (never throws) on any missing component/dims — the jointLength preload
   * (P11 S3) is a best-effort live-preview aid, not load-bearing for Add.
   */
  const loadJointPanelInput = async (
    opfs: { read(p: string): Promise<Uint8Array> },
    asm: { components: Array<{ partPath: string; position: { x: number; y: number; z: number } }> },
    partPath: string,
  ): Promise<{ dims: { length: number; width: number; thickness: number }; pose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] } } | null> => {
    try {
      const comp = asm.components.find((c) => c.partPath === partPath);
      if (!comp) return null;
      const bytes = await opfs.read(partPath);
      const project = await unpackProject(bytes);
      const doc = (project.manifest as { document?: { featureTree?: Array<Record<string, unknown>> } } | null)?.document;
      const panel = (doc?.featureTree ?? []).find((f) => f.kind === 'panel') as
        | { length: unknown; width: unknown; thickness: unknown }
        | undefined;
      if (!panel) return null;
      const num = (v: unknown): number | null => {
        if (typeof v === 'number') return v;
        if (v !== null && typeof v === 'object' && (v as Record<string, unknown>).kind === 'literal') {
          const val = (v as { value: unknown }).value;
          if (typeof val === 'number') return val;
        }
        return null;
      };
      const length = num(panel.length), width = num(panel.width), thickness = num(panel.thickness);
      if (length === null || width === null || thickness === null) return null;
      const dims = { length, width, thickness };
      const translation = {
        x: comp.position.x + dims.length / 2,
        y: comp.position.y + dims.width / 2,
        z: comp.position.z + dims.thickness / 2,
      };
      return { dims, pose: { translation, quaternion: [0, 0, 0, 1] } };
    } catch {
      return null;
    }
  };

  /** Real joint edge length (P11 D4) for the dialog's auto-layout live preview,
   *  computed fresh here (not cached) — mirrors AddTenonMortiseCommand's own
   *  re-derive-fresh convention. null when it can't be determined. */
  const computeTenonMortiseJointLength = async (
    opfs: { read(p: string): Promise<Uint8Array> },
    panelPathA: string,
    panelPathB: string,
  ): Promise<number | null> => {
    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return null;
    const a = await loadJointPanelInput(opfs, asm, panelPathA);
    const b = await loadJointPanelInput(opfs, asm, panelPathB);
    if (!a || !b) return null;
    const joint = inferManualJoint(a, b);
    if (!joint) return null;
    const { p0, p1 } = joint.line;
    return Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  };

  const handleAddTenonMortise = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handleA = viewport.beginOneComponentPick(resolvePartPath, (panelPathA: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      const handleB = viewport.beginOneComponentPick(resolvePartPath, (panelPathB: string) => {
        useAppStore.getState().setOneComponentPickHandle(null);
        void (async () => {
          const opfs = await Opfs.forNavigator();
          const jointLength = await computeTenonMortiseJointLength(opfs, panelPathA, panelPathB);
          useAppStore.getState().setTenonMortiseDialog({
            panelPathA,
            panelPathB,
            jointLength,
            onSubmit: async (params: TenonMortiseCreateInput) => {
              const submitOpfs = await Opfs.forNavigator();
              const beforeA = await tenonMortiseFeatureCount(submitOpfs, panelPathA);
              const beforeB = await tenonMortiseFeatureCount(submitOpfs, panelPathB);
              const cmd = new AddTenonMortiseCommand({ panelPathA, panelPathB, params, opfs: submitOpfs, store: useAppStore });
              await useAppStore.getState().bus.execute(cmd);
              const afterA = await tenonMortiseFeatureCount(submitOpfs, panelPathA);
              const afterB = await tenonMortiseFeatureCount(submitOpfs, panelPathB);
              const unchanged =
                beforeA !== null && afterA !== null && beforeB !== null && afterB !== null &&
                afterA === beforeA && afterB === beforeB;
              // Auto-layout clamping (P11 D5) is a definitive signal from the command
              // itself — check it ahead of the featureTree-diff no-op heuristic, since
              // a clamped-but-successful Add is never a no-op (mutually exclusive in
              // real usage; ordering keeps the two toasts unambiguous either way).
              if (cmd.clamped) {
                showToast?.(t('toast.tenonMortiseClamped'));
              } else if (unchanged) {
                showToast?.(t('toast.tenonMortiseNoJoint'));
              }
            },
            onCancel: () => useAppStore.getState().setTenonMortiseDialog(null),
          });
        })();
      });
      useAppStore.getState().setOneComponentPickHandle(handleB);
    });
    useAppStore.getState().setOneComponentPickHandle(handleA);
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
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleCornerCabinet(); }}
            aria-label={t('ribbon.furniture.cornerCabinet')}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
          >
            {t('ribbon.furniture.cornerCabinet')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleBlindCornerCabinet(); }}
            aria-label={t('ribbon.furniture.blindCornerCabinet')}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
          >
            {t('ribbon.furniture.blindCornerCabinet')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleDiagonalCornerCabinet(); }}
            aria-label={t('ribbon.furniture.diagonalCornerCabinet')}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
          >
            {t('ribbon.furniture.diagonalCornerCabinet')}
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
            onClick={() => void useAppStore.getState().bus.execute(new RenumberCutListCommand({ result: cutListResult }))}>{t('tab.asm.renumber')}</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new ExportCutListCsvCommand({
              result: cutListResult,
              connectorRows,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-cutlist.csv`,
            }).apply()}>{t('ribbon.furniture.exportCsv')}</button>
        </RibbonPanel>
      </div>
      <div aria-label={t('ribbon.furniture.statisticsPanel')}>
        <RibbonPanel title={t('ribbon.furniture.statistics')}>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new OpenStatisticsReportTabCommand().apply()}>{t('ribbon.furniture.statistics')}</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new ExportStatisticsCsvCommand({
              report: statisticsReport,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-statistics.csv`,
            }).apply()}>{t('common.export_csv')}</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new ExportStatisticsXlsxCommand({
              report: statisticsReport,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-statistics.xlsx`,
            }).apply()}>{t('common.export_xlsx')}</button>
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
            onClick={() => { handleAddLegLevelers(); }}
            aria-label={t('dialog.legLevelers.title')}
          >
            {t('dialog.legLevelers.title')}
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
            onClick={() => { handleAddFaceFrame(); }}
            aria-label={t('aria.add_face_frame', 'Add Face Frame')}
          >
            {t('ribbon.furniture.addFaceFrame', 'Add Face Frame')}
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
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddGroove(); }}
            aria-label={t('ribbon.furniture.groove')}
          >
            {t('ribbon.furniture.groove')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddKeyholeSlot(); }}
            aria-label={t('ribbon.furniture.keyholeSlot')}
          >
            {t('ribbon.furniture.keyholeSlot')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddTenonMortise(); }}
            aria-label={t('ribbon.furniture.tenonMortise')}
          >
            {t('ribbon.furniture.tenonMortise')}
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
              // Clear bores from all panels (including nested .ziasm sub-assemblies).
              // Each ClearBoresCommand is undoable independently.
              void (async () => {
                const opfs = await Opfs.forNavigator();
                const entries = await collectBoreDocsForClear(asm, opfs);
                for (const { partPath, doc } of entries) {
                  await state.bus.execute(new ClearBoresCommand({ doc, partPath, opfs }));
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
              showToast,
            }).apply()}>
            {t('ribbon.furniture.exportBoringDxf')}
          </button>
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly || panelManufacturingInputs.length === 0}
            aria-disabled={!activeAssembly || panelManufacturingInputs.length === 0}
            onClick={() => void new ExportPanelManufacturingDxfCommand({
              inputs: panelManufacturingInputs,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-manufacturing.zip`,
              diagnostics: cutListResult.diagnostics,
              showToast,
              mode: dxfExportMode,
              layerScheme,
            }).apply()}>
            {t('ribbon.furniture.exportManufacturingDxf')}
          </button>
          <span className="text-xs text-neutral-500" aria-label={t('ribbon.furniture.dxfExportMode')}>
            {t('ribbon.furniture.dxfExportMode')}
          </span>
          <button type="button"
            className={dxfExportMode === 'folders' ? 'text-xs text-white' : 'text-xs hover:text-white text-neutral-500'}
            aria-pressed={dxfExportMode === 'folders'}
            onClick={() => useAppStore.getState().setDxfExportMode('folders')}>
            {t('ribbon.furniture.dxfModeFolders')}
          </button>
          <button type="button"
            className={dxfExportMode === 'combined' ? 'text-xs text-white' : 'text-xs hover:text-white text-neutral-500'}
            aria-pressed={dxfExportMode === 'combined'}
            onClick={() => useAppStore.getState().setDxfExportMode('combined')}>
            {t('ribbon.furniture.dxfModeCombined')}
          </button>
          <span className="text-xs text-neutral-500" aria-label={t('ribbon.furniture.layerScheme')}>
            {t('ribbon.furniture.layerScheme')}
          </span>
          <button type="button"
            className={layerScheme === 'native' ? 'text-xs text-white' : 'text-xs hover:text-white text-neutral-500'}
            aria-pressed={layerScheme === 'native'}
            onClick={() => useAppStore.getState().setLayerScheme('native')}>
            {t('ribbon.furniture.layerSchemeNative')}
          </button>
          <button type="button"
            className={layerScheme === 'abf' ? 'text-xs text-white' : 'text-xs hover:text-white text-neutral-500'}
            aria-pressed={layerScheme === 'abf'}
            onClick={() => useAppStore.getState().setLayerScheme('abf')}>
            {t('ribbon.furniture.layerSchemeAbf')}
          </button>
          <button type="button" className="text-xs hover:text-white"
            aria-label={t('ribbon.furniture.machiningPresets')}
            onClick={() => useAppStore.getState().toggleMachiningPresetsDialog(true)}>
            {t('ribbon.furniture.machiningPresets')}
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
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly?.nest}
            aria-disabled={!activeAssembly?.nest}
            onClick={async () => {
              if (!activeAssembly?.nest) return;
              await new ExportNestDxfCommand({
                nest: activeAssembly.nest,
                materials: activeAssembly.materials,
                suggestedName: `${activeAssembly.name}-nest.zip`,
                mode: dxfExportMode,
              }).apply();
            }}>
            {t('ribbon.furniture.exportNestDxf')}
          </button>
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly || cutListResult.rows.length === 0}
            aria-disabled={!activeAssembly || cutListResult.rows.length === 0}
            onClick={() => {
              if (!activeAssembly || cutListResult.rows.length === 0) return;
              void new ExportPanelLabelsCommand({
                cutListResult,
                suggestedName: `${activeAssembly.name ?? 'assembly'}-labels.pdf`,
                templateId: labelTemplate,
                headerLine1: labelHeaderLine1,
                headerLine2: labelHeaderLine2,
                ...(activeAssembly.nest ? { nest: activeAssembly.nest } : {}),
              }).apply();
            }}>
            {t('ribbon.furniture.exportLabels')}
          </button>
          <button type="button"
            className={labelTemplate === 'rich' ? 'text-xs text-white' : 'text-xs hover:text-white text-neutral-500'}
            aria-pressed={labelTemplate === 'rich'}
            onClick={() => useAppStore.getState().setLabelTemplate('rich')}>
            {t('ribbon.furniture.labelTemplateRich')}
          </button>
          <button type="button"
            className={labelTemplate === 'compact' ? 'text-xs text-white' : 'text-xs hover:text-white text-neutral-500'}
            aria-pressed={labelTemplate === 'compact'}
            onClick={() => useAppStore.getState().setLabelTemplate('compact')}>
            {t('ribbon.furniture.labelTemplateCompact')}
          </button>
          <input type="text" className="text-xs bg-shell-panel border border-shell-border rounded px-1 w-24"
            aria-label={t('ribbon.furniture.labelHeaderLine1')}
            placeholder={t('ribbon.furniture.labelHeaderLine1')}
            value={labelHeaderLine1}
            onChange={(e) => useAppStore.getState().setLabelHeaderLine1(e.target.value)} />
          <input type="text" className="text-xs bg-shell-panel border border-shell-border rounded px-1 w-24"
            aria-label={t('ribbon.furniture.labelHeaderLine2')}
            placeholder={t('ribbon.furniture.labelHeaderLine2')}
            value={labelHeaderLine2}
            onChange={(e) => useAppStore.getState().setLabelHeaderLine2(e.target.value)} />
          <select className="text-xs bg-shell-panel border border-shell-border rounded px-1"
            aria-label={t('ribbon.furniture.loadHeaderPreset')}
            value=""
            onChange={(e) => {
              const preset = labelHeaderPresets.find((p) => p.id === e.target.value);
              if (!preset) return;
              useAppStore.getState().setLabelHeaderLine1(preset.line1);
              useAppStore.getState().setLabelHeaderLine2(preset.line2);
            }}>
            <option value="">{t('ribbon.furniture.loadHeaderPreset')}</option>
            {labelHeaderPresets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button type="button" className="text-xs hover:text-white"
            aria-label={t('ribbon.furniture.manageHeaderPresets')}
            onClick={() => useAppStore.getState().toggleLabelHeaderPresetsDialog(true)}>
            {t('ribbon.furniture.manageHeaderPresets')}
          </button>
        </RibbonPanel>
      </div>
      <div aria-label={t('ribbon.furniture.productionPanel')}>
        <RibbonPanel title={t('ribbon.furniture.production')}>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new OpenProductionTabCommand().apply()}>
            {t('ribbon.furniture.openProduction')}
          </button>
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cutListResult.rows.length === 0}
            aria-disabled={cutListResult.rows.length === 0}
            onClick={() => {
              if (cutListResult.rows.length === 0) return;
              void new ExportPackingSlipPdfCommand({
                rows: buildPackingSlipRows(cutListResult, activeAssembly?.producedPanels),
                suggestedName: `${activeAssembly?.name ?? 'assembly'}-packing-slip.pdf`,
              }).apply();
            }}>
            {t('ribbon.furniture.exportPackingSlip')}
          </button>
        </RibbonPanel>
      </div>
    </div>
  );
}
