// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * ADR-101: the profile line through a corner perpendicular to a measuring direction, shared by
 * the drawing import (counted copies) and the STEP PMI export (a corner whose edge is gone).
 */

import type { SketchEntity } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { profileLineAcross } from '../src/pmi';

const point = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: 'point',
  x,
  y,
  construction: false,
});
const line = (id: string, start: string, end: string): SketchEntity => ({
  id,
  kind: 'line',
  start,
  end,
  construction: false,
});

// A rectangle a(0,0) b(20,0) c(20,10) d(0,10), lines L1 bottom … L4 left; a slanted line S from a.
const entities: SketchEntity[] = [
  point('a', 0, 0),
  point('b', 20, 0),
  point('c', 20, 10),
  point('d', 0, 10),
  point('e', 6, 8),
  line('L1', 'a', 'b'),
  line('L2', 'b', 'c'),
  line('L3', 'c', 'd'),
  line('L4', 'd', 'a'),
  line('S', 'a', 'e'),
];
const rect = new Set(['L1', 'L2', 'L3', 'L4']);

describe('profileLineAcross', () => {
  it('is the one loop line through the corner across the direction', () => {
    expect(profileLineAcross(entities, rect, 'a', [1, 0])).toBe('L4');
    expect(profileLineAcross(entities, rect, 'a', [0, 1])).toBe('L1');
    expect(profileLineAcross(entities, rect, 'b', [1, 0])).toBe('L2');
    expect(profileLineAcross(entities, rect, 'c', [0, -1])).toBe('L3');
  });

  it('is nothing for a direction no line through the corner is across, or off the loop', () => {
    expect(profileLineAcross(entities, rect, 'a', [0.6, 0.8])).toBeUndefined();
    // S is across (0.8, -0.6) but not in the loop.
    expect(profileLineAcross(entities, rect, 'a', [0.8, -0.6])).toBeUndefined();
    expect(profileLineAcross(entities, new Set([...rect, 'S']), 'a', [0.8, -0.6])).toBe('S');
    expect(profileLineAcross(entities, rect, 'e', [1, 0])).toBeUndefined();
  });
});
