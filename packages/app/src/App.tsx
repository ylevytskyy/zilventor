export default function App() {
  return (
    <div className="grid h-full" style={{ gridTemplateRows: 'auto auto 1fr auto', gridTemplateColumns: '220px 1fr 260px' }}>
      <header role="banner" className="col-span-3 bg-shell-panel border-b border-shell-border" id="region-appbar">
        <div className="px-3 py-1 text-sm font-semibold">ZilInventor</div>
      </header>
      <div role="navigation" aria-label="Ribbon" className="col-span-3 bg-shell-panel border-b border-shell-border" id="region-ribbon">
        <div className="px-3 py-2 text-xs text-neutral-400">Ribbon — Task 15</div>
      </div>
      <aside role="complementary" aria-label="Browser" className="bg-shell-panel border-r border-shell-border" id="region-browser">
        <div className="px-3 py-2 text-xs text-neutral-400">Browser pane — Task 16</div>
      </aside>
      <main role="main" id="region-viewport" className="bg-shell">
        <div className="p-3 text-xs text-neutral-400">Viewport — Task 17</div>
      </main>
      <aside role="complementary" aria-label="Properties" className="bg-shell-panel border-l border-shell-border" id="region-properties">
        <div className="px-3 py-2 text-xs text-neutral-400">Properties — Task 21</div>
      </aside>
      <footer role="contentinfo" className="col-span-3 bg-shell-panel border-t border-shell-border" id="region-statusbar">
        <div className="px-3 py-1 text-xs text-neutral-400">Status — Task 16</div>
      </footer>
    </div>
  );
}
