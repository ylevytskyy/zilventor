// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MirrorComponentDialog } from '../MirrorComponentDialog';

const COMPONENTS = [{ id: 'c1', label: 'side-panel' }];

describe('MirrorComponentDialog', () => {
  it('renders source dropdown and plane buttons YZ / XZ / XY', () => {
    render(<MirrorComponentDialog components={COMPONENTS} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'YZ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'XZ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'XY' })).toBeInTheDocument();
  });

  it('OK is disabled when no component', () => {
    render(<MirrorComponentDialog components={[]} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('onCommit called with sourceComponentId and plane', () => {
    const onCommit = vi.fn();
    render(<MirrorComponentDialog components={COMPONENTS} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.submit(screen.getByRole('dialog'));
    expect(onCommit).toHaveBeenCalledWith({ sourceComponentId: 'c1', plane: 'yz' });
  });
});
