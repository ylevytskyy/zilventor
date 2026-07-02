import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import RibbonTab from './RibbonTab';
import FileTab from './tabs/FileTab';
import ModelTab from './tabs/ModelTab';
import SketchTab from './tabs/SketchTab';
import ViewTab from './tabs/ViewTab';
import FurnitureTab from './tabs/FurnitureTab';
import InspectTab from './tabs/InspectTab';
import DrawingTab from './tabs/DrawingTab';
import { AssemblyTab } from './tabs/AssemblyTab';
import { useAppStore } from '../store/useAppStore';
import type { PartInfo } from '@zilventor/shared';

const PART_TABS     = ['File', 'Model',    'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
const ASSEMBLY_TABS = ['File', 'Assembly', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
const DRAWING_TABS  = ['File', 'Drawing',  'View'] as const;

type Props = {
  partInfo?: Map<string, PartInfo>;
  onImportDxfIntoSketch?: ((file: File) => Promise<void>) | undefined;
  showToast?: ((message: string) => void) | undefined;
};

export default function Ribbon({ partInfo, onImportDxfIntoSketch, showToast }: Props = {}) {
  const { t } = useTranslation();
  const kind = useAppStore((s) => s.activeDocument?.kind ?? 'part');
  const TABS: string[] =
    kind === 'drawing'  ? [...DRAWING_TABS]  :
    kind === 'assembly' ? [...ASSEMBLY_TABS] :
    [...PART_TABS];

  const partPanels: Record<string, ReactElement> = {
    File: <FileTab />,
    Model: <ModelTab />,
    Sketch: <SketchTab onImportDxfIntoSketch={onImportDxfIntoSketch} />,
    Furniture: <FurnitureTab showToast={showToast} />,
    Inspect: <InspectTab />,
    Drawing: <DrawingTab />,
    View: <ViewTab />,
  };

  const assemblyPanels: Record<string, ReactElement> = {
    File: <FileTab />,
    Assembly: <AssemblyTab partInfo={partInfo ?? new Map()} />,
    Sketch: <SketchTab onImportDxfIntoSketch={onImportDxfIntoSketch} />,
    Furniture: <FurnitureTab showToast={showToast} />,
    Inspect: <InspectTab />,
    Drawing: <DrawingTab />,
    View: <ViewTab />,
  };

  const drawingPanels: Record<string, ReactElement> = {
    File:    <FileTab />,
    Drawing: <DrawingTab />,
    View:    <ViewTab />,
  };

  const panels =
    kind === 'drawing'  ? drawingPanels  :
    kind === 'assembly' ? assemblyPanels :
    partPanels;
  const defaultTab =
    kind === 'drawing'  ? 'Drawing'  :
    kind === 'assembly' ? 'Assembly' :
    'Model';

  const [active, setActive] = useState<string>(defaultTab);

  // When mode switches, reset active tab to the mode default if the current
  // active tab no longer exists in the new tab list.
  const resolvedActive = TABS.includes(active) ? active : defaultTab;

  return (
    <div className="flex flex-col">
      <div role="tablist" className="flex border-b border-shell-border bg-ribbon-tab">
        {TABS.map((tab) => (
          <RibbonTab key={tab} label={t(`tab.${tab.toLowerCase()}`)} selected={tab === resolvedActive} onSelect={() => setActive(tab)} />
        ))}
      </div>
      <div className="bg-ribbon-bg min-h-[72px]">{panels[resolvedActive]}</div>
    </div>
  );
}
