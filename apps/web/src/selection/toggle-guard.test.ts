import { describe, expect, it } from 'vitest';
import { DOUBLE_CLICK_MS, ToggleGuard } from './toggle-guard';

describe('ToggleGuard', () => {
  it('a slow second click deselects', () => {
    const g = new ToggleGuard();
    expect(g.click('a', false, 0)).toBe('select');
    expect(g.click('a', true, DOUBLE_CLICK_MS + 1)).toBe('deselect');
  });

  it('a double click on something unselected ends selected', () => {
    const g = new ToggleGuard();
    expect(g.click('a', false, 0)).toBe('select');
    expect(g.click('a', true, 120)).toBe('keep');
    // The gesture is over: the next click, even a quick one, is a new click.
    expect(g.click('a', true, 200)).toBe('deselect');
  });

  it('a double click on something selected ends selected too', () => {
    const g = new ToggleGuard();
    expect(g.click('a', true, 1000)).toBe('deselect');
    expect(g.click('a', false, 1100)).toBe('select');
  });

  it('quick clicks on different things are separate clicks', () => {
    const g = new ToggleGuard();
    expect(g.click('a', false, 0)).toBe('select');
    expect(g.click('b', true, 50)).toBe('deselect');
  });
});
