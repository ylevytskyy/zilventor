import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenWorkPlaneDialogCommand } from '../OpenWorkPlaneDialogCommand';
import { OpenWorkAxisDialogCommand } from '../OpenWorkAxisDialogCommand';
import { OpenWorkPointDialogCommand } from '../OpenWorkPointDialogCommand';

describe('Open work-feature dialog commands', () => {
  beforeEach(() => {
    useAppStore.getState().resetWorkAxisDialog();
    useAppStore.getState().resetWorkPlaneDialog();
    useAppStore.getState().resetWorkPointDialog();
  });

  it('OpenWorkPlaneDialogCommand opens the dialog from a fresh slot', () => {
    useAppStore.setState({ editingWorkPlaneId: 'WP9' } as never);
    OpenWorkPlaneDialogCommand();
    const s = useAppStore.getState();
    expect(s.workPlaneDialogOpen).toBe(true);
    expect(s.editingWorkPlaneId).toBeNull();
  });

  it('OpenWorkAxisDialogCommand opens the dialog from a fresh slot', () => {
    OpenWorkAxisDialogCommand();
    expect(useAppStore.getState().workAxisDialogOpen).toBe(true);
  });

  it('OpenWorkPointDialogCommand opens the dialog from a fresh slot', () => {
    OpenWorkPointDialogCommand();
    expect(useAppStore.getState().workPointDialogOpen).toBe(true);
  });
});
