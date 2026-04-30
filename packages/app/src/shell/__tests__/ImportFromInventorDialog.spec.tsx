import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportFromInventorDialog } from '../ImportFromInventorDialog';

describe('ImportFromInventorDialog', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ImportFromInventorDialog isOpen={false} onCancel={() => {}} onConfirm={() => {}} status={{ kind: 'idle' }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the conflict radios and import/cancel buttons when open', () => {
    render(
      <ImportFromInventorDialog isOpen={true} onCancel={() => {}} onConfirm={() => {}} status={{ kind: 'idle' }} />
    );
    expect(screen.getByLabelText(/overwrite/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/skip/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cancel on conflict/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('default conflict is "skip"', () => {
    render(
      <ImportFromInventorDialog isOpen={true} onCancel={() => {}} onConfirm={() => {}} status={{ kind: 'idle' }} />
    );
    expect((screen.getByLabelText(/skip/i) as HTMLInputElement).checked).toBe(true);
  });

  it('clicking a radio updates selection; Import dispatches onConfirm with chosen policy', () => {
    const onConfirm = vi.fn();
    render(
      <ImportFromInventorDialog isOpen={true} onCancel={() => {}} onConfirm={onConfirm} status={{ kind: 'idle' }} />
    );
    fireEvent.click(screen.getByLabelText(/overwrite/i));
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));
    expect(onConfirm).toHaveBeenCalledWith('overwrite');
  });

  it('Cancel button fires onCancel without calling onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ImportFromInventorDialog isOpen={true} onCancel={onCancel} onConfirm={onConfirm} status={{ kind: 'idle' }} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows progress text when status.kind === "importing"', () => {
    render(
      <ImportFromInventorDialog
        isOpen={true} onCancel={() => {}} onConfirm={() => {}}
        status={{ kind: 'importing', current: 3, total: 7, path: 'sub/Hinge.ipt.json' }}
      />
    );
    const progress = screen.getByText(/3 \/ 7/);
    expect(progress).toBeInTheDocument();
    expect(progress.textContent).toMatch(/Hinge\.ipt\.json/);
  });

  it('disables Import while importing', () => {
    render(
      <ImportFromInventorDialog
        isOpen={true} onCancel={() => {}} onConfirm={() => {}}
        status={{ kind: 'importing', current: 1, total: 2, path: 'a' }}
      />
    );
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
  });

  it('shows summary text when status.kind === "done"', () => {
    render(
      <ImportFromInventorDialog
        isOpen={true} onCancel={() => {}} onConfirm={() => {}}
        status={{ kind: 'done', summary: { partsImported: 5, assembliesImported: 2, skipped: 1, errors: [] } }}
      />
    );
    expect(screen.getByText(/5 parts/i)).toBeInTheDocument();
    expect(screen.getByText(/2 assemblies/i)).toBeInTheDocument();
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument();
  });

  it('shows error message when status.kind === "error"', () => {
    render(
      <ImportFromInventorDialog
        isOpen={true} onCancel={() => {}} onConfirm={() => {}}
        status={{ kind: 'error', message: 'something went wrong' }}
      />
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
