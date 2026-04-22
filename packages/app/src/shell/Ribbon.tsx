import { useState, type ReactElement } from 'react';
import RibbonTab from './RibbonTab';
import FileTab from './tabs/FileTab';
import ModelTab from './tabs/ModelTab';
import SketchTab from './tabs/SketchTab';
import ViewTab from './tabs/ViewTab';
import FurnitureTab from './tabs/FurnitureTab';
import InspectTab from './tabs/InspectTab';
import DrawingTab from './tabs/DrawingTab';

const TABS = ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
type TabName = typeof TABS[number];

const panels: Record<TabName, ReactElement> = {
  File: <FileTab />,
  Model: <ModelTab />,
  Sketch: <SketchTab />,
  Furniture: <FurnitureTab />,
  Inspect: <InspectTab />,
  Drawing: <DrawingTab />,
  View: <ViewTab />
};

export default function Ribbon() {
  const [active, setActive] = useState<TabName>('Model');
  return (
    <div className="flex flex-col">
      <div role="tablist" className="flex border-b border-shell-border bg-ribbon-tab">
        {TABS.map((t) => <RibbonTab key={t} label={t} selected={t === active} onSelect={() => setActive(t)} />)}
      </div>
      <div className="bg-ribbon-bg min-h-[72px]">{panels[active]}</div>
    </div>
  );
}
