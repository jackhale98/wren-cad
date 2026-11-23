/**
 * The profile line through a sketch corner perpendicular to a measuring direction (ADR-101): a
 * distance along `along` from a corner equals the distance from the line through it that runs
 * across `along`, so a dimension between corners can be measured between the side faces those
 * lines generate. Used by the drawing import (counted copies, promote.ts) and by the STEP PMI
 * export when a corner's swept edge is gone (kernel-client regen/pmi.ts). Exact or nothing: the
 * one non-construction line of the profile loop through the point whose extent along `along` is
 * zero (within 1e-9 of its length); none or several → undefined.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Id, SketchEntity } from '@wren-cad/contracts';

/**
 * The line of `loop` (curve ids of a profile region) through point `point` perpendicular to
 * `along` (a unit vector in the sketch's u/v), or undefined when there is not exactly one.
 */
export function profileLineAcross(
  entities: readonly SketchEntity[],
  loop: ReadonlySet<Id>,
  point: Id,
  along: readonly [number, number],
): Id | undefined {
  const pt = (id: Id) => {
    const e = entities.find((x) => x.id === id);
    return e?.kind === 'point' ? e : undefined;
  };
  const lines: Id[] = [];
  for (const e of entities) {
    if (e.kind !== 'line' || e.construction || !loop.has(e.id)) continue;
    if (e.start !== point && e.end !== point) continue;
    const a = pt(e.start);
    const b = pt(e.end);
    if (!a || !b) continue;
    const d = Math.abs((b.x - a.x) * along[0] + (b.y - a.y) * along[1]);
    const l = Math.hypot(a.x - b.x, a.y - b.y);
    if (l > 0 && d <= 1e-9 * Math.max(1, l)) lines.push(e.id);
  }
  return lines.length === 1 ? lines[0] : undefined;
}
