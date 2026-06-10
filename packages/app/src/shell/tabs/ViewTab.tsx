import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/useAppStore';
import { ToggleShowComponentColorsCommand } from '../../commands/ToggleShowComponentColorsCommand';
import { ToggleShowEdgeBandsCommand } from '../../commands/ToggleShowEdgeBandsCommand';

export default function ViewTab() {
  const { t } = useTranslation();
  const showComponentColors = useAppStore((s) => s.showComponentColors);
  const showEdgeBands = useAppStore((s) => s.showEdgeBands);
  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button className="hover:text-white">{t('ribbon.view.fit')}</button>
      <button className="hover:text-white">{t('ribbon.view.home')}</button>
      <button
        className="hover:text-white"
        onClick={async () => {
          const cmd = new ToggleShowComponentColorsCommand();
          await cmd.apply();
        }}
      >
        {showComponentColors ? '✓ ' : ''}{t('ribbon.view.showComponentColors')}
      </button>
      <button
        className="hover:text-white"
        onClick={async () => {
          const cmd = new ToggleShowEdgeBandsCommand();
          await cmd.apply();
        }}
      >
        {showEdgeBands ? '✓ ' : ''}{t('ribbon.view.showEdgeBands')}
      </button>
    </div>
  );
}
