import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('autoRegen store flag', () => {
  beforeEach(() => { localStorage.removeItem('autoRegen'); });

  it('defaults to true', () => {
    expect(useAppStore.getState().autoRegen).toBe(true);
  });

  it('setAutoRegen(false) updates state and persists to localStorage', () => {
    useAppStore.getState().setAutoRegen(false);
    expect(useAppStore.getState().autoRegen).toBe(false);
    expect(localStorage.getItem('autoRegen')).toBe('false');
  });

  it('setAutoRegen(true) persists "true"', () => {
    useAppStore.getState().setAutoRegen(true);
    expect(localStorage.getItem('autoRegen')).toBe('true');
    expect(useAppStore.getState().autoRegen).toBe(true);
  });
});
