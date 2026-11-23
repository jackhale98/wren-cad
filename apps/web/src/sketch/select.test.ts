import { describe, expect, it } from 'vitest';
import { additiveSelect, nextSelection } from './select';

describe('sketch selection by click or tap', () => {
  it('a touch or Pencil tap adds; a mouse click replaces unless a modifier is held', () => {
    expect(additiveSelect({ pointerType: 'touch' })).toBe(true);
    expect(additiveSelect({ pointerType: 'pen' })).toBe(true);
    expect(additiveSelect({ pointerType: 'mouse' })).toBe(false);
    for (const k of ['shiftKey', 'metaKey', 'ctrlKey'] as const)
      expect(additiveSelect({ pointerType: 'mouse', [k]: true })).toBe(true);
  });

  it('adds, replaces, and removes what is already selected (any input)', () => {
    expect(nextSelection(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(nextSelection(['a'], 'b', false)).toEqual(['b']);
    expect(nextSelection(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(nextSelection(['a', 'b'], 'a', false)).toEqual(['b']);
    // The Point tool on a selected point keeps it selected.
    expect(nextSelection(['a'], 'a', false, false)).toEqual(['a']);
  });
});
