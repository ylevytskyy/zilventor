import { useAppStore } from '../../store/useAppStore';
import { ToggleShowComponentColorsCommand } from '../../commands/ToggleShowComponentColorsCommand';

export default function ViewTab() {
  const showComponentColors = useAppStore((s) => s.showComponentColors);
  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button className="hover:text-white">Fit (F)</button>
      <button className="hover:text-white">Home</button>
      <button
        className="hover:text-white"
        onClick={async () => {
          const cmd = new ToggleShowComponentColorsCommand();
          await cmd.apply();
        }}
      >
        {showComponentColors ? '✓ ' : ''}Show component colors
      </button>
    </div>
  );
}
