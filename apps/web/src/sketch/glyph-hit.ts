/**
 * Touch and Pencil reach a constraint glyph with a 44 px target (PLAN §9: touch targets) without
 * the glyph's box stealing taps from the geometry next to it: the glyph stays 20 px, and a tap
 * that picks no geometry selects the glyph whose centre is within 22 px. Geometry always wins.
 */

/** Half the touch target (44 px). */
export const GLYPH_REACH_PX = 22;

/** The constraint id of the glyph nearest a touch or Pencil tap, within reach; else null. */
export function glyphNear(
  e: { clientX: number; clientY: number; pointerType?: string },
  root: ParentNode = document,
): string | null {
  if (!e.pointerType || e.pointerType === 'mouse') return null;
  let best: { id: string; d: number } | null = null;
  for (const el of root.querySelectorAll<HTMLElement>('[data-constraint-id]')) {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    const id = el.dataset.constraintId;
    if (id && d <= GLYPH_REACH_PX && (!best || d < best.d)) best = { id, d };
  }
  return best?.id ?? null;
}
