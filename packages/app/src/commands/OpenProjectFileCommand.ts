import { useAppStore } from '../store/useAppStore';
import i18n from '../i18n';

export function OpenProjectFileCommand(partPath: string): boolean {
  const s = useAppStore.getState();
  if (partPath.endsWith('.ziasm')) {
    const doc = s.subAssemblyDocs[partPath];
    if (!doc) {
      s.setStatus(i18n.t('status.openFile.notLoaded', { partPath }));
      return false;
    }
    s.setActiveDocument({ kind: 'assembly', document: doc });
    s.setStatus(i18n.t('status.openFile.opened', { partPath }));
    return true;
  }
  s.setStatus(i18n.t('status.openFile.unsupportedType', { partPath }));
  return false;
}
