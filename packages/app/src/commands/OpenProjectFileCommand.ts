import { useAppStore } from '../store/useAppStore';

export function OpenProjectFileCommand(partPath: string): boolean {
  const s = useAppStore.getState();
  if (partPath.endsWith('.ziasm')) {
    const doc = s.subAssemblyDocs[partPath];
    if (!doc) {
      s.setStatus(`Cannot open: ${partPath} not loaded`);
      return false;
    }
    s.setActiveDocument({ kind: 'assembly', document: doc });
    s.setStatus(`Opened ${partPath}`);
    return true;
  }
  s.setStatus(`Cannot open: ${partPath} (only .ziasm sub-assemblies supported)`);
  return false;
}
