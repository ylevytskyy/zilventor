import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHardwareDialogCommand } from '../OpenHardwareDialogCommand';
import { useAppStore } from '../../store/useAppStore';

beforeEach(() => {
  useAppStore.setState({ hardwareDialog: null, activeAssembly: null });
});

describe('OpenHardwareDialogCommand', () => {
  it('apply() throws NO_ACTIVE_ASSEMBLY when no assembly is active', async () => {
    const cmd = new OpenHardwareDialogCommand({ onSubmit: vi.fn(), onCancel: vi.fn() });
    await expect(cmd.apply()).rejects.toThrow('NO_ACTIVE_ASSEMBLY');
  });

  it('apply() sets hardwareDialog slot in store when assembly is active', async () => {
    useAppStore.setState({
      activeAssembly: { id: 'a1', name: 'Asm', units: 'mm', parameters: {}, components: [],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [] },
    });
    const onSubmit = vi.fn();
    const cmd = new OpenHardwareDialogCommand({ onSubmit, onCancel: vi.fn() });
    await cmd.apply();
    expect(useAppStore.getState().hardwareDialog).not.toBeNull();
    expect(useAppStore.getState().hardwareDialog?.onSubmit).toBe(onSubmit);
  });

  it('revert() is a no-op', async () => {
    const cmd = new OpenHardwareDialogCommand({ onSubmit: vi.fn(), onCancel: vi.fn() });
    await expect(cmd.revert()).resolves.toBeUndefined();
  });
});
