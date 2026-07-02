import type { ReactNode } from 'react';
type Props = { title: string; children: ReactNode };
export default function RibbonPanel({ title, children }: Props) {
  return (
    <div className="flex flex-col items-stretch bg-shell-panel border border-shell-border rounded px-2 py-1 gap-1 min-w-[72px] flex-shrink-0">
      <div className="flex gap-1 justify-center">{children}</div>
      <div className="text-[10px] text-neutral-500 text-center border-t border-shell-border pt-1">{title}</div>
    </div>
  );
}
