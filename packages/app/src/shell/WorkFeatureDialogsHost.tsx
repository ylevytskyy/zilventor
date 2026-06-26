import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { WorkPlaneDialog, type WorkPlaneCommit } from './WorkPlaneDialog';
import { WorkAxisDialog, type WorkAxisCommit } from './WorkAxisDialog';
import { WorkPointDialog, type WorkPointCommit } from './WorkPointDialog';
import { CabinetDialog } from './CabinetDialog';
import { CornerCabinetDialog } from './CornerCabinetDialog';
import { BlindCornerCabinetDialog } from './BlindCornerCabinetDialog';
import { DiagonalCornerCabinetDialog } from './DiagonalCornerCabinetDialog';
import { HardwareDialog } from './HardwareDialog';
import { NestDialog } from './NestDialog';
import { BoringDialog } from './BoringDialog';
import { AddDoorDialog } from './AddDoorDialog';
import { DrawerBankDialog } from './DrawerBankDialog';
import { LegLevelersDialog } from './LegLevelersDialog';
import { DrawerHandleDialog } from './DrawerHandleDialog';
import { ShelfPinDialog } from './ShelfPinDialog';
import { FaceFrameDialog } from './FaceFrameDialog';
import { GrooveDialog } from './GrooveDialog';

export type WorkFeatureDialogsHostProps = {
  onWorkPlaneCommit: (c: WorkPlaneCommit) => void;
  onWorkAxisCommit: (c: WorkAxisCommit) => void;
  onWorkPointCommit: (c: WorkPointCommit) => void;
};

export function WorkFeatureDialogsHost({
  onWorkPlaneCommit,
  onWorkAxisCommit,
  onWorkPointCommit,
}: WorkFeatureDialogsHostProps): React.ReactElement {
  const planeOpen = useAppStore((s) => s.workPlaneDialogOpen);
  const planeInit = useAppStore((s) => s.workPlaneInitialValues);
  const axisOpen = useAppStore((s) => s.workAxisDialogOpen);
  const axisInit = useAppStore((s) => s.workAxisInitialValues);
  const pointOpen = useAppStore((s) => s.workPointDialogOpen);
  const pointInit = useAppStore((s) => s.workPointInitialValues);

  return (
    <>
      {planeOpen && (
        <WorkPlaneDialog
          initialValues={planeInit}
          onCommit={onWorkPlaneCommit}
          onCancel={() => useAppStore.getState().resetWorkPlaneDialog()}
        />
      )}
      {axisOpen && (
        <WorkAxisDialog
          initialValues={axisInit}
          onCommit={onWorkAxisCommit}
          onCancel={() => useAppStore.getState().resetWorkAxisDialog()}
        />
      )}
      {pointOpen && (
        <WorkPointDialog
          initialValues={pointInit}
          onCommit={onWorkPointCommit}
          onCancel={() => useAppStore.getState().resetWorkPointDialog()}
        />
      )}
      <CabinetDialog />
      <CornerCabinetDialog />
      <BlindCornerCabinetDialog />
      <DiagonalCornerCabinetDialog />
      <HardwareDialog />
      <NestDialog />
      <BoringDialog />
      <AddDoorDialog />
      <DrawerBankDialog />
      <LegLevelersDialog />
      <DrawerHandleDialog />
      <ShelfPinDialog />
      <FaceFrameDialog />
      <GrooveDialog />
    </>
  );
}
