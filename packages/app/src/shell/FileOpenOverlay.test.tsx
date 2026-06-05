import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FileOpenOverlay from './FileOpenOverlay';
import { useAppStore } from '../store/useAppStore';

describe('FileOpenOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ fileOpen: null, fileOpenSeq: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing when no file is opening', () => {
    const { container } = render(<FileOpenOverlay onCancel={() => {}} />);
    expect(container.querySelector('[data-testid="file-open-overlay"]')).toBeNull();
  });

  it('shows the filename while opening', () => {
    useAppStore.setState({ fileOpen: { fileName: 'gizmo.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={() => {}} />);
    expect(screen.getByTestId('file-open-overlay')).toBeTruthy();
    expect(screen.getByText(/Opening gizmo\.step/)).toBeTruthy();
  });

  it('updates elapsed time every second', () => {
    useAppStore.setState({ fileOpen: { fileName: 'a.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={() => {}} />);
    expect(screen.getByTestId('file-open-elapsed').textContent).toContain('0s');
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('file-open-elapsed').textContent).toContain('2s');
  });

  it('hides the long-wait hint until 3s elapse', () => {
    useAppStore.setState({ fileOpen: { fileName: 'a.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={() => {}} />);
    expect(screen.queryByText(/take several minutes/i)).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText(/take several minutes/i)).toBeTruthy();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    useAppStore.setState({ fileOpen: { fileName: 'a.step', startedAtMs: Date.now() } });
    render(<FileOpenOverlay onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
