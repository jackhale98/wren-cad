import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportMenu, type ExportMenuProps } from '../src';
import { renderUI } from './helpers';

async function open(props: Partial<ExportMenuProps> = {}) {
  const onExport = vi.fn();
  renderUI(<ExportMenu onExport={onExport} {...props} />);
  await userEvent.click(screen.getByRole('button', { name: 'Export' }));
  await screen.findByTestId('export-form');
  return { onExport };
}

describe('Save as project folder', () => {
  it('is a format beside .wrencad and emits the folder target', async () => {
    const { onExport } = await open();
    await userEvent.click(screen.getByRole('radio', { name: /Project folder/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save as project folder' }));
    expect(onExport).toHaveBeenCalledWith({ target: 'folder', options: {} });
  });

  it('is disabled with one line saying why where the picker is missing', async () => {
    await open({ unavailable: { folder: 'Needs Chrome or Edge. Use Connections instead.' } });
    expect(screen.getByRole('radio', { name: /Project folder/ })).toBeDisabled();
    expect(screen.getByText('Needs Chrome or Edge. Use Connections instead.')).toBeInTheDocument();
  });

  it('shows a refusal inline, as an alert and not a dialog', async () => {
    await open({
      defaultTarget: 'folder',
      folder: { error: 'This folder holds a different Wren project.' },
    });
    expect(screen.getByTestId('export-folder-error')).toHaveTextContent('different Wren project');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(screen.queryByTestId('export-folder-replace')).toBeNull();
  });

  it('offers Replace inline only when the host says the refusal can be overridden', async () => {
    const onReplace = vi.fn();
    await open({
      defaultTarget: 'folder',
      folder: { error: 'This folder already holds the Wren project “Gearbox”.', onReplace },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Replace what is there' }));
    expect(onReplace).toHaveBeenCalledTimes(1);
  });
});

describe('git notice', () => {
  it('appears for .wrencad when the host says the project is in git, with the folder action', async () => {
    const { onExport } = await open({
      defaultTarget: 'wren',
      folder: { gitNotice: { onNeverShow: vi.fn() } },
    });
    expect(screen.getByTestId('export-git-notice')).toHaveTextContent(
      'This is a git repository. A project folder can be diffed and merged; a .wrencad cannot.',
    );
    const notice = screen.getByTestId('export-git-notice');
    await userEvent.click(within(notice).getByRole('button', { name: 'Save as project folder' }));
    expect(onExport).toHaveBeenCalledWith({ target: 'folder', options: {} });
  });

  it('is absent without the host flag', async () => {
    await open({ defaultTarget: 'wren' });
    expect(screen.queryByTestId('export-git-notice')).toBeNull();
  });

  it('is absent while STEP is chosen', async () => {
    await open({ defaultTarget: 'step', folder: { gitNotice: { onNeverShow: vi.fn() } } });
    expect(screen.queryByTestId('export-git-notice')).toBeNull();
  });

  it('is absent where the folder is unavailable', async () => {
    await open({
      defaultTarget: 'wren',
      unavailable: { folder: 'No picker.' },
      folder: { gitNotice: { onNeverShow: vi.fn() } },
    });
    expect(screen.queryByTestId('export-git-notice')).toBeNull();
  });

  it('can be dismissed without telling the host', async () => {
    const never = vi.fn();
    await open({ defaultTarget: 'wren', folder: { gitNotice: { onNeverShow: never } } });
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('export-git-notice')).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });

  it('"Don’t show again" calls the host and hides it', async () => {
    const never = vi.fn();
    await open({ defaultTarget: 'wren', folder: { gitNotice: { onNeverShow: never } } });
    await userEvent.click(screen.getByRole('button', { name: 'Don’t show again' }));
    expect(never).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByTestId('export-git-notice')).toBeNull());
  });
});
