import { useTranslation } from 'react-i18next';

export function StubTab({ subProject, what }: { subProject: number; what: string }) {
  const { t } = useTranslation();
  return (
    <div className="px-3 py-4 text-xs text-neutral-500">
      {t('stub.comingIn', { what, subProject })}
    </div>
  );
}
