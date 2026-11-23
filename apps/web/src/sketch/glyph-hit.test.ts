import { describe, expect, it } from 'vitest';
import { GLYPH_REACH_PX, glyphNear } from './glyph-hit';

/** A fake root with glyphs whose 20 px boxes are centred at the given points. */
function root(glyphs: Array<{ id: string; x: number; y: number }>): ParentNode {
  const els = glyphs.map((g) => ({
    dataset: { constraintId: g.id },
    getBoundingClientRect: () => ({ left: g.x - 10, top: g.y - 10, width: 20, height: 20 }),
  }));
  return { querySelectorAll: () => els } as unknown as ParentNode;
}

describe('glyphNear (44 px touch reach, geometry first)', () => {
  const r = root([
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 160, y: 100 },
  ]);
  it('a touch or Pencil tap within 22 px of a glyph centre picks the nearest glyph', () => {
    expect(
      glyphNear({ clientX: 100 + GLYPH_REACH_PX - 1, clientY: 100, pointerType: 'touch' }, r),
    ).toBe('a');
    expect(glyphNear({ clientX: 145, clientY: 100, pointerType: 'pen' }, r)).toBe('b');
  });
  it('out of reach, or a mouse click, picks nothing (the mouse uses the 20 px glyph itself)', () => {
    expect(
      glyphNear({ clientX: 100, clientY: 100 + GLYPH_REACH_PX + 1, pointerType: 'touch' }, r),
    ).toBeNull();
    expect(glyphNear({ clientX: 100, clientY: 100, pointerType: 'mouse' }, r)).toBeNull();
  });
});
