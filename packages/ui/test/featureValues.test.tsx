import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FeatureValues, featureValueLabel, ParamLinksContext } from '../src';
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

  it('never offers Make parameter, but still lists existing parameters to link by name', async () => {
    const make = vi.fn(() => undefined);
    const withWidth = makeEvaluator([{ name: 'width', expr: '80mm' }]);
    const onCommit = vi.fn();
    renderUI(
      <ParamLinksContext.Provider value={{ params: [{ name: 'width', value: '80 mm' }], make }}>
        <FeatureValues
          name="Extrude 1"
          fields={fields}
          evaluate={(e) => withWidth(e)}
          units={{ length: 'mm', angle: '°' }}
          onCommit={onCommit}
        />
      </ParamLinksContext.Provider>,
    );
    const fx = (await screen.findAllByTestId('param-fx'))[0];
    if (!fx) throw new Error('no parameter button');
    await userEvent.click(fx);
    expect(await screen.findByRole('option', { name: /width/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Make parameter/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make parameter' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    const depth = screen.getByRole('textbox', { name: 'Depth' });
    await userEvent.click(depth);
    await userEvent.keyboard('{Control>}a{/Control}width{Enter}');
    expect(onCommit).toHaveBeenCalledWith('/end/depth', 'width');
    expect(make).not.toHaveBeenCalled();
  });
});
