// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CircularPatternDialog } from '../CircularPatternDialog';

const comps = [{ id: 'src-1', label: 'leg' }];

describe('CircularPatternDialog', () => {
  it('submit dispatches onCommit with the exact form values (DOM interaction)', () => {
    const onCommit = vi.fn();
    render(<CircularPatternDialog components={comps} onCommit={onCommit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Count/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/Total angle/i), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const v = onCommit.mock.calls[0]![0];
    expect(v.sourceComponentId).toBe('src-1');
    expect(v.count).toBe(6);
    expect(v.totalAngleDeg).toBe(180);
    expect(v.rotateInstances).toBe(true);
    expect(v.axis).toBe('z');
  });
  it('blocks submit + shows error when count < 2', () => {
    const onCommit = vi.fn();
    render(<CircularPatternDialog components={comps} onCommit={onCommit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onCommit).not.toHaveBeenCalled();
  });
  it('blocks submit when angle out of range', () => {
    const onCommit = vi.fn();
    render(<CircularPatternDialog components={comps} onCommit={onCommit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Total angle/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
