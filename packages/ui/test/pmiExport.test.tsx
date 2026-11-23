import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildExportRequest, ExportMenu, PmiReport } from '../src';
import { renderUI } from './helpers';

/* M5a (ADR-100): the STEP option "AP242 with model dimensions and tolerances (PMI)" and the
   non-modal report after an export or import. */

describe('STEP PMI export option', () => {
  it('builds AP242 with PMI, without presentation, or plain AP214', () => {
    const base = {
      target: 'step' as const,
      stlBinary: true,
      stlPerBody: false,
      quality: 'standard' as const,
    };
    expect(buildExportRequest({ ...base, stepPmi: { pmi: true, presentation: true } })).toEqual({
      target: 'step',
      options: { stepSchema: 'AP242', pmi: {} },
    });
    expect(buildExportRequest({ ...base, stepPmi: { pmi: true, presentation: false } })).toEqual({
      target: 'step',
      options: { stepSchema: 'AP242', pmi: { presentation: false } },
    });
    expect(buildExportRequest({ ...base, stepPmi: { pmi: false, presentation: true } })).toEqual({
      target: 'step',
      options: { stepSchema: 'AP214' },
    });
    // PMI is a STEP option only.
    expect(
      buildExportRequest({ ...base, target: 'stl', stepPmi: { pmi: true, presentation: true } })
        .options.pmi,
    ).toBeUndefined();
  });

  async function open(annotations: number) {
    const onExport = vi.fn();
    renderUI(<ExportMenu onExport={onExport} pmi={{ annotations }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByTestId('export-form');
    return onExport;
  }

  it('is on by default when the part has annotations, with presentation', async () => {
    const onExport = await open(18);
    const box = screen.getByTestId('export-pmi');
    const pmi = within(box).getByRole('switch', {
      name: 'AP242 with model dimensions and tolerances (PMI)',
    });
    expect(pmi).toHaveAttribute('aria-checked', 'true');
    expect(within(box).getByRole('switch', { name: /presentation/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(box).toHaveTextContent('18 annotations');
    await userEvent.click(screen.getByRole('button', { name: 'Export STEP' }));
    expect(onExport).toHaveBeenCalledWith({
      target: 'step',
      options: { stepSchema: 'AP242', pmi: {} },
    });
  });

  it('the presentation can be left out, and PMI turned off', async () => {
    const onExport = await open(3);
    await userEvent.click(screen.getByRole('switch', { name: /presentation/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Export STEP' }));
    expect(onExport).toHaveBeenLastCalledWith({
      target: 'step',
      options: { stepSchema: 'AP242', pmi: { presentation: false } },
    });
  });

  it('is off by default without annotations, and hides the presentation toggle', async () => {
    const onExport = await open(0);
    const pmi = screen.getByRole('switch', { name: /PMI/ });
    expect(pmi).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('switch', { name: /presentation/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Export STEP' }));
    expect(onExport).toHaveBeenCalledWith({ target: 'step', options: { stepSchema: 'AP214' } });
  });

  it('has no PMI option for other formats or hosts that give no annotation count', async () => {
    renderUI(<ExportMenu onExport={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByTestId('export-form');
    expect(screen.queryByTestId('export-pmi')).toBeNull();
  });
});

describe('PMI report', () => {
  it('lists every skipped item with its reason, and dismisses', async () => {
    const onDismiss = vi.fn();
    renderUI(
      <PmiReport
        title="Exported 16 annotations as PMI"
        entries={[
          {
            label: 'Linear dimension 20',
            reason: 'Its sketch point is not on the solid',
          },
          {
            label: 'Chamfer callout',
            reason: 'Chamfer callouts are not exported as PMI yet',
          },
        ]}
        onDismiss={onDismiss}
      />,
    );
    const report = screen.getByTestId('pmi-report');
    expect(report).toHaveAttribute('role', 'status');
    expect(document.activeElement).not.toBe(within(report).getByTestId('pmi-report-dismiss'));
    const items = within(report).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Linear dimension 20 — not included: Its sketch point');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('groups a repeated cause into one line with a count', async () => {
    renderUI(
      <PmiReport
        title="Imported 3 annotations from a.step"
        entries={Array.from({ length: 9 }, (_, i) => ({
          label: `GT${i}`,
          reason: 'Tolerance value could not be read',
        }))}
        onDismiss={() => {}}
      />,
    );
    const rows = within(screen.getByTestId('pmi-report-entries')).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('9× Tolerance value could not be read');
    expect(rows[0]).toHaveTextContent('GT0, GT1, GT2 and 6 more');
    await userEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    await waitFor(() => expect(screen.queryByTestId('pmi-report-entries')).toBeNull());
  });

  it('shows summary counts, lost before approximated, cosmetic behind one line', async () => {
    renderUI(
      <PmiReport
        title="Imported 12 annotations from a.step"
        counts={{ done: 12, verb: 'imported' }}
        entries={[
          { label: 'F1', reason: 'Filled text', code: 'filledPresentation', severity: 'cosmetic' },
          { label: 'F2', reason: 'Filled text', code: 'filledPresentation', severity: 'cosmetic' },
          { label: 'A1', reason: 'Zone read as cylindrical', severity: 'approximated' },
          { label: 'L1', reason: 'No value' },
          { label: 'L2', reason: 'No geometry', code: 'datumNoGeometry', severity: 'lost' },
          { label: 'L3', reason: 'No geometry', code: 'datumNoGeometry', severity: 'lost' },
        ]}
        onDismiss={() => {}}
      />,
    );
    const report = screen.getByTestId('pmi-report');
    expect(within(report).getByTestId('pmi-report-summary')).toHaveTextContent(
      '12 imported · 3 not imported · 1 approximated · 2 cosmetic',
    );
    const rows = within(within(report).getByTestId('pmi-report-entries')).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-severity'))).toEqual([
      'lost',
      'lost',
      'approximated',
    ]);
    expect(rows[0]).toHaveTextContent('2× No geometry');
    expect(within(report).queryByTestId('pmi-report-cosmetic')).toBeNull();
    const toggle = within(report).getByTestId('pmi-report-cosmetic-toggle');
    expect(toggle).toHaveTextContent('2 cosmetic differences');
    await userEvent.click(toggle);
    const cosmetic = within(report).getByTestId('pmi-report-cosmetic');
    expect(within(cosmetic).getAllByRole('listitem')).toHaveLength(1);
    // Non-modal, never takes focus.
    expect(report.contains(document.activeElement) && document.activeElement !== toggle).toBe(
      false,
    );
  });
});
