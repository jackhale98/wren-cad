import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FeatureValues, featureValueLabel } from '../src';
import { makeEvaluator, renderUI } from './helpers';

const evaluate = makeEvaluator([]);

describe('FeatureValues (phone review layout, editValues)', () => {
  const fields = [
    { pointer: '/end/depth', label: 'Depth', value: '10 mm', expected: 'length' as const },
    { pointer: '/draft', label: 'Draft angle', value: '2 deg', expected: 'angle' as const },
  ];

  it('shows one inline field per value, titled with the feature, and nothing structural', () => {
    renderUI(
      <FeatureValues
        name="Extrude 1"
        fields={fields}
        evaluate={(e) => evaluate(e)}
        units={{ length: 'mm', angle: '°' }}
        onCommit={() => {}}
      />,
    );
    expect(screen.getByRole('region', { name: 'Values of Extrude 1' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Depth' })).toHaveValue('10 mm');
    expect(screen.getByRole('textbox', { name: 'Draft angle' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Delete|Rename|Edit/ })).toBeNull();
  });

  it('commits an expression with units as one edit', async () => {
    const onCommit = vi.fn();
    renderUI(
      <FeatureValues
        name="Extrude 1"
        fields={fields}
        evaluate={(e) => evaluate(e)}
        units={{ length: 'mm', angle: '°' }}
        onCommit={onCommit}
      />,
    );
    const depth = screen.getByRole('textbox', { name: 'Depth' });
    await userEvent.click(depth);
    await userEvent.keyboard('{Control>}a{/Control}12 mm{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('/end/depth', '12 mm');
  });

  it('Done calls onDone; a feature with no values says so', async () => {
    const onDone = vi.fn();
    renderUI(
      <FeatureValues
        name="Boolean 1"
        fields={[]}
        evaluate={(e) => evaluate(e)}
        units={{ length: 'mm', angle: '°' }}
        onCommit={() => {}}
        onDone={onDone}
      />,
    );
    expect(screen.getByText(/no values to edit/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('labels match the inspector, with a readable fallback', () => {
    expect(featureValueLabel('/end/depth')).toBe('Depth');
    expect(featureValueLabel('/second/count')).toBe('Second count');
    expect(featureValueLabel('/something/else')).toBe('Else');
  });
});
