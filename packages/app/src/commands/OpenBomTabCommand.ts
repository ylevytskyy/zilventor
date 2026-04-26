import { useAppStore } from '../store/useAppStore';

export class OpenBomTabCommand {
  async apply(): Promise<void> { useAppStore.getState().setBomTabActive(true); }
}
