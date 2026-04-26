import { useState, type ReactElement } from 'react';
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

const PART_TABS = ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
const ASSEMBLY_TABS = ['File', 'Assembly', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;

type Props = { partNames?: Map<string, string> };

export default function Ribbon({ partNames }: Props = {}) {
  const isAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');
  const TABS: string[] = isAssembly ? [...ASSEMBLY_TABS] : [...PART_TABS];

  const partPanels: Record<string, ReactElement> = {
    File: <FileTab />,
    Model: <ModelTab />,
    Sketch: <SketchTab />,
    Furniture: <FurnitureTab />,
    Inspect: <InspectTab />,
    Drawing: <DrawingTab />,
    View: <ViewTab />,
  };

  const assemblyPanels: Record<string, ReactElement> = {
    File: <FileTab />,
    Assembly: <AssemblyTab partNames={partNames ?? new Map()} />,
    Sketch: <SketchTab />,
    Furniture: <FurnitureTab />,
    Inspect: <InspectTab />,
    Drawing: <DrawingTab />,
    View: <ViewTab />,
  };

  const panels = isAssembly ? assemblyPanels : partPanels;
  const defaultTab = isAssembly ? 'Assembly' : 'Model';

  const [active, setActive] = useState<string>(defaultTab);

  // When mode switches, reset active tab to the mode default if the current
  // active tab no longer exists in the new tab list.
  const resolvedActive = TABS.includes(active) ? active : defaultTab;

  return (
    <div className="flex flex-col">
      <div role="tablist" className="flex border-b border-shell-border bg-ribbon-tab">
        {TABS.map((t) => (
          <RibbonTab key={t} label={t} selected={t === resolvedActive} onSelect={() => setActive(t)} />
        ))}
      </div>
      <div className="bg-ribbon-bg min-h-[72px]">{panels[resolvedActive]}</div>
    </div>
  );
}
