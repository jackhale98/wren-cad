import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalResult, Tolerance } from '@wren-cad/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ToleranceEditor, type ToleranceEditorProps } from '../src/drawing';
import { negate, switchTolerance, toleranceExpr } from '../src/drawing/toleranceModel';
import { renderUI } from './helpers';

const evalOk = (e: string): EvalResult => {
  const n = Number.parseFloat(e.replace(/[−–]/g, '-'));
  return Number.isNaN(n)
    ? { ok: false, error: { message: 'Not a number' } }
    : { ok: true, value: n, dimension: [0, 0, 0, 0], dependsOn: [] };
};

/** A small ISO 286 stand-in: H7 and g6 at 20 mm, a table that ends at 500 mm. */
const TABLE: Record<string, [number, number]> = {
  H6: [0.013, 0],
  H7: [0.021, 0],
  H8: [0.033, 0],
  JS7: [0.0105, -0.0105],
  g5: [-0.007, -0.016],
  g6: [-0.007, -0.02],
  g7: [-0.007, -0.028],
  h6: [0, -0.013],
  h7: [0, -0.021],
};
const fits = {
  maxSize: 500,
  deviations: (c: string, size: number) =>
    size > 500
      ? { ok: false as const, reason: 'beyond the table' }
      : TABLE[c]
        ? {
            ok: true as const,
            upper: (TABLE[c] as [number, number])[0],
            lower: (TABLE[c] as [number, number])[1],
          }
        : { ok: false as const, reason: `no value for ${c}` },
  choices: (side: 'hole' | 'shaft', size: number) =>
    size > 500
      ? []
      : side === 'hole'
        ? [
            { letter: 'H', grades: [6, 7, 8] },
            { letter: 'JS', grades: [7] },
          ]
        : [
            { letter: 'g', grades: [5, 6, 7] },
            { letter: 'h', grades: [6, 7] },
          ],
};

function setup(over: Partial<ToleranceEditorProps> & { noSize?: boolean } = {}) {
  const onCommit = vi.fn();
  const { noSize, ...rest } = over;
  const props: ToleranceEditorProps = {
    value: undefined,
    evaluate: evalOk,
    measured: 20,
    fits,
    onCommit,
    ...rest,
  };
  if (noSize) delete props.measured;
  const r = renderUI(<ToleranceEditor {...props} />);
  return { onCommit, ...r };
}
const tile = (name: string) => screen.getByRole('radio', { name: name });
const previewText = () => screen.getByTestId('tolerance-preview-svg').getAttribute('data-text');

describe('ToleranceEditor: the type choice', () => {
  it('shows all seven types at once, each drawn as it will look, with the current one checked', () => {
    setup({ value: { kind: 'symmetric', value: '0.1 mm' } });
    const group = screen.getByRole('radiogroup', { name: 'Tolerance type' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'None',
      'Symmetric',
      'Deviation',
      'Limits',
      'Fit',
      'Basic',
      'Reference',
    ]);
    expect(tile('Symmetric')).toBeChecked();
    // Each tile carries a drawing of the sheet's own label.
    expect(tile('Symmetric').querySelector('svg')).toHaveAttribute('data-text', '25 ±0.1');
    expect(tile('Basic').querySelector('svg')).toHaveAttribute('data-text', '[25]');
    expect(tile('Reference').querySelector('svg')).toHaveAttribute('data-text', '(25)');
    expect(tile('Fit').querySelector('svg')).toHaveAttribute('data-text', '25 H7');
  });

  it('touch targets are 44 px (min-h-11) and the fields take the touch size', () => {
    setup({ value: { kind: 'symmetric', value: '0.1 mm' }, size: 'touch' });
    for (const r of screen.getAllByRole('radio')) expect(r.className).toMatch(/min-h-11/);
    expect(screen.getByRole('textbox', { name: 'Type it' }).className).toMatch(/h-11/);
  });

  it('arrow keys move through the types', async () => {
    const { onCommit } = setup({ value: { kind: 'symmetric', value: '0.1 mm' } });
    tile('Symmetric').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'bilateral', upper: '0.1 mm', lower: '-0.1 mm' },
    });
  });
});

describe('ToleranceEditor: the fields of each type', () => {
  it('none: no fields, a line saying so; Basic and Reference: no fields, one line of meaning', () => {
    const { unmount } = setup();
    expect(tile('None')).toBeChecked();
    expect(screen.queryByRole('textbox', { name: /deviation|limit|Symmetric/ })).toBeNull();
    expect(screen.getByTestId('tolerance-editor')).toHaveTextContent(/general tolerance/);
    unmount();
    const b = setup({ value: { kind: 'basic' } });
    expect(screen.getByTestId('tolerance-editor')).toHaveTextContent(/theoretically exact/);
    expect(screen.queryByTestId('fit-fields')).toBeNull();
    expect(previewText()).toBe('[20]');
    b.unmount();
    setup({ value: { kind: 'reference' } });
    expect(screen.getByTestId('tolerance-editor')).toHaveTextContent(
      /not toleranced and not checked/,
    );
    expect(previewText()).toBe('(20)');
  });

  it('symmetric: one value, committed with its unit', async () => {
    const { onCommit } = setup({ value: { kind: 'symmetric', value: '0.1 mm' } });
    const f = screen.getByRole('textbox', { name: 'Symmetric tolerance' });
    expect(f).toHaveValue('0.1 mm');
    await userEvent.clear(f);
    await userEvent.type(f, '0.25{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'symmetric', value: '0.25 mm' },
    });
    expect(previewText()).toBe('20 ±0.1');
  });

  it('symmetric: a typed sign is dropped, and zero is not a tolerance', async () => {
    const { onCommit } = setup({ value: { kind: 'symmetric', value: '0.1 mm' } });
    const f = screen.getByRole('textbox', { name: 'Symmetric tolerance' });
    await userEvent.clear(f);
    await userEvent.type(f, '-0.2{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'symmetric', value: '0.2 mm' },
    });
    onCommit.mockClear();
    await userEvent.clear(f);
    await userEvent.type(f, '0{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('deviation: upper and lower, signed, one commit each; upper below lower is refused with a reason', async () => {
    const { onCommit } = setup({
      value: { kind: 'bilateral', upper: '0.1 mm', lower: '-0.1 mm' },
    });
    const up = screen.getByRole('textbox', { name: 'Upper deviation' });
    const lo = screen.getByRole('textbox', { name: 'Lower deviation' });
    await userEvent.clear(up);
    await userEvent.type(up, '+0.2{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'bilateral', upper: '0.2 mm', lower: '-0.1 mm' },
    });
    onCommit.mockClear();
    await userEvent.clear(lo);
    await userEvent.type(lo, '0.5{Enter}'); // +0.5 is above the upper deviation 0.1
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/upper deviation is below the lower/);
    await userEvent.clear(lo);
    await userEvent.type(lo, '-0.05{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'bilateral', upper: '0.1 mm', lower: '-0.05 mm' },
    });
  });

  it('limits: shown and typed as limits, stored as deviations from the nominal', async () => {
    const { onCommit } = setup({
      measured: 25,
      value: { kind: 'limits', upper: '0.2 mm', lower: '-0.1 mm' },
    });
    const up = screen.getByRole('textbox', { name: 'Upper limit' });
    const lo = screen.getByRole('textbox', { name: 'Lower limit' });
    expect(up).toHaveValue('25.2');
    expect(lo).toHaveValue('24.9');
    await userEvent.clear(up);
    await userEvent.type(up, '25.3{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'limits', upper: '0.3 mm', lower: '-0.1 mm' },
    });
    onCommit.mockClear();
    await userEvent.clear(lo);
    await userEvent.type(lo, '25.5{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/upper limit is below the lower limit/);
  });

  it('limits without a dimension value say what is missing', () => {
    setup({
      noSize: true,
      value: { kind: 'limits', upper: '0.2 mm', lower: '-0.1 mm' },
    });
    expect(screen.queryByRole('textbox', { name: 'Upper limit' })).toBeNull();
    expect(screen.getByTestId('tolerance-editor')).toHaveTextContent(/Limits are sizes/);
  });
});

describe('ToleranceEditor: switching type keeps what can be kept', () => {
  const ctx = { quantity: 'length' as const, evaluate: evalOk, size: 20, fits };
  it('± 0.1 → +0.1/−0.1 → limits keeps the numbers', () => {
    const sym: Tolerance = { kind: 'symmetric', value: '0.1 mm' };
    const dev = switchTolerance(sym, 'bilateral', ctx);
    expect(dev).toEqual({ kind: 'bilateral', upper: '0.1 mm', lower: '-0.1 mm' });
    expect(switchTolerance(dev as Tolerance, 'limits', ctx)).toEqual({
      kind: 'limits',
      upper: '0.1 mm',
      lower: '-0.1 mm',
    });
  });
  it('a lopsided pair becomes ± the larger side', () => {
    expect(
      switchTolerance({ kind: 'bilateral', upper: '0.1 mm', lower: '-0.3 mm' }, 'symmetric', ctx),
    ).toEqual({ kind: 'symmetric', value: '0.3 mm' });
  });
  it('a fit with deviations becomes those deviations', () => {
    expect(switchTolerance({ kind: 'fit', hole: 'H7', show: 'symbol' }, 'bilateral', ctx)).toEqual({
      kind: 'bilateral',
      upper: '0.021 mm',
      lower: '0 mm',
    });
  });
  it('from nothing: defaults; a fit is H7 when the size has it, and impossible with no size', () => {
    expect(switchTolerance(undefined, 'symmetric', ctx)).toEqual({
      kind: 'symmetric',
      value: '0.1 mm',
    });
    expect(switchTolerance(undefined, 'fit', ctx)).toEqual({
      kind: 'fit',
      hole: 'H7',
      show: 'symbol',
    });
    expect(switchTolerance(undefined, 'fit', { ...ctx, size: undefined })).toBeUndefined();
    expect(switchTolerance(undefined, 'fit', { ...ctx, quantity: 'angle' })).toBeUndefined();
    expect(switchTolerance({ kind: 'basic' }, 'none', ctx)).toBeNull();
  });
  it('negate and the bare-number rule', () => {
    expect(negate('0.1 mm')).toBe('-0.1 mm');
    expect(negate('-0.1 mm')).toBe('0.1 mm');
    expect(negate('a+b')).toBe('-(a+b)');
    expect(negate('0 mm')).toBe('0 mm');
    expect(toleranceExpr('+0.2', 'length')).toBe('0.2 mm');
    expect(toleranceExpr('−0.1', 'angle')).toBe('-0.1 deg');
    expect(toleranceExpr('0.1in', 'length')).toBe('0.1in');
  });

  it('clicking a type commits one tolerance; the nominal is never sent', async () => {
    const { onCommit } = setup({ value: { kind: 'bilateral', upper: '0.1 mm', lower: '-0.1 mm' } });
    await userEvent.click(tile('Limits'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'limits', upper: '0.1 mm', lower: '-0.1 mm' },
    });
    await userEvent.click(tile('None'));
    expect(onCommit).toHaveBeenLastCalledWith({ tolerance: null });
    await userEvent.click(tile('Basic'));
    expect(onCommit).toHaveBeenLastCalledWith({ tolerance: { kind: 'basic' } });
  });
});

describe('ToleranceEditor: fits', () => {
  const fit: Tolerance = { kind: 'fit', hole: 'H7', show: 'symbol' };

  it('offers only the letters and grades the table has, and shows the deviations live', async () => {
    const { onCommit } = setup({ value: fit });
    const grade = screen.getByRole('combobox', { name: 'Hole grade' });
    expect(
      within(grade)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['6', '7', '8']);
    expect(
      within(screen.getByRole('combobox', { name: 'Hole letter' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['none', 'H', 'JS']);
    expect(screen.getByTestId('fit-deviations')).toHaveTextContent('H7: +0.021 / 0 mm');
    await userEvent.selectOptions(grade, '8');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'fit', hole: 'H8', show: 'symbol' },
    });
    // JS has only IT7: choosing it lands on grade 7.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Hole letter' }), 'JS');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'fit', hole: 'JS7', show: 'symbol' },
    });
  });

  it('adds a shaft class, and cannot remove the last class', async () => {
    const { onCommit } = setup({ value: fit });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Shaft letter' }), 'g');
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'fit', hole: 'H7', shaft: 'g6', show: 'symbol' },
    });
    // With only a hole class, "none" for the hole is not offered.
    const none = within(screen.getByRole('combobox', { name: 'Hole letter' })).getByRole('option', {
      name: 'none',
    });
    expect(none).toBeDisabled();
  });

  it('the display choice: symbol, with deviations, as limits', async () => {
    const { onCommit } = setup({ value: fit });
    await userEvent.click(screen.getByRole('radio', { name: 'Symbol with its deviations' }));
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'fit', hole: 'H7', show: 'symbolAndDeviations' },
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Limits with the symbol' }));
    expect(onCommit).toHaveBeenLastCalledWith({
      tolerance: { kind: 'fit', hole: 'H7', show: 'limitsAndSymbol' },
    });
  });

  it('a class with no value at this size cannot be displayed with deviations, and says so', () => {
    setup({ value: { kind: 'fit', hole: 'H11', show: 'symbol' } });
    expect(screen.getByRole('radio', { name: 'Symbol with its deviations' })).toBeDisabled();
    expect(screen.getByTestId('fit-deviations')).toHaveTextContent(/no value for H11/);
  });

  it('outside the table, and with no size, it says why there is nothing to pick', () => {
    const { unmount } = setup({ value: fit, measured: 600 });
    expect(screen.getByTestId('fit-fields')).toHaveTextContent(
      /outside the ISO 286 table \(up to 500 mm\)/,
    );
    expect(screen.queryByRole('combobox', { name: 'Hole letter' })).toBeNull();
    unmount();
    setup({ value: fit, noSize: true });
    expect(screen.getByTestId('tolerance-editor')).toHaveTextContent(/no value yet/);
  });

  it('a fit on an angle is disabled with the reason from the rules', () => {
    setup({
      quantity: 'angle',
      measured: 30,
      fitDisabled: 'An ISO 286 fit applies to a size, not to an angle dimension',
    });
    expect(tile('Fit')).toBeDisabled();
    expect(screen.getByTestId('tolerance-editor')).toHaveTextContent(
      /Fit unavailable: An ISO 286 fit applies to a size/,
    );
  });

  it('the preview shows the fit as the sheet draws it', async () => {
    setup({ value: { kind: 'fit', hole: 'H7', shaft: 'g6', show: 'symbolAndDeviations' } });
    expect(previewText()).toBe('20 H7/g6 (+0.021/0 ; -0.007/-0.02)');
  });
});

describe('ToleranceEditor: inspection, preview and "Type it"', () => {
  it('the inspection switch edits the flag; the preview draws the frame', async () => {
    const onChange = vi.fn();
    setup({
      value: { kind: 'symmetric', value: '0.1 mm' },
      inspection: { checked: false, onChange },
    });
    const sw = screen.getByRole('switch', { name: 'Inspection dimension' });
    expect(sw).not.toBeChecked();
    expect(previewText()).toBe('20 ±0.1');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is drawn in a frame when on, and off and explained for a reference', () => {
    const { unmount } = setup({
      value: { kind: 'symmetric', value: '0.1 mm' },
      inspection: { checked: true, onChange: () => {} },
    });
    expect(previewText()).toBe('⟨20 ±0.1⟩');
    expect(screen.getByTestId('tolerance-preview-svg').querySelectorAll('path')).toHaveLength(2);
    unmount();
    setup({
      value: { kind: 'reference' },
      inspection: { checked: true, onChange: () => {} },
    });
    const sw = screen.getByRole('switch', { name: 'Inspection dimension' });
    expect(sw).toBeDisabled();
    expect(sw).not.toBeChecked();
    expect(screen.getByTestId('tolerance-editor')).toHaveTextContent(
      /reference dimension is information only/,
    );
    expect(previewText()).toBe('(20)');
  });

  it('no inspection switch for annotations that have none (hole callouts)', () => {
    setup({ value: undefined });
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('"Type it" fills the structured form through parseTolerance, nominal included', async () => {
    const { onCommit } = setup();
    const f = screen.getByRole('textbox', { name: 'Type it' });
    await userEvent.type(f, '20 H7/g6{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith({
      nominal: '20 mm',
      tolerance: { kind: 'fit', hole: 'H7', shaft: 'g6', show: 'symbol' },
    });
  });

  it('the preview of an unresolved dimension shows ?, never a stale value', () => {
    setup({ value: { kind: 'symmetric', value: '0.1 mm' }, noSize: true });
    expect(previewText()).toBe('?');
  });
});
