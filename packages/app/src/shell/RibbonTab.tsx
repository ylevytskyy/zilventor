type Props = { label: string; selected: boolean; onSelect(): void };
export default function RibbonTab({ label, selected, onSelect }: Props) {
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`px-3 py-1 text-xs border-b-2 ${selected ? 'text-white border-ribbon-accent bg-ribbon-active font-semibold' : 'text-neutral-400 border-transparent hover:text-neutral-200'}`}
    >
      {label}
    </button>
  );
}
