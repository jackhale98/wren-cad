// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_DEFS,
  ANNOTATION_KINDS,
  annotationExprFields,
  DIMENSION_KINDS,
  describeAnnotation,
  isValuedKind,
} from '../src';

describe('ANNOTATION_DEFS', () => {
  it('has exactly one entry per kind in ANNOTATION_KINDS, keyed by its own kind', () => {
    expect(Object.keys(ANNOTATION_DEFS).sort()).toEqual([...ANNOTATION_KINDS].sort());
    for (const k of ANNOTATION_KINDS) expect(ANNOTATION_DEFS[k].kind).toBe(k);
  });

  it('gives every kind a distinct title and export name', () => {
    const titles = ANNOTATION_KINDS.map((k) => ANNOTATION_DEFS[k].title);
    const names = ANNOTATION_KINDS.map((k) => ANNOTATION_DEFS[k].exportName);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(names).size).toBe(names.length);
    for (const s of [...titles, ...names]) expect(s).not.toBe('');
  });

  it('derives DIMENSION_KINDS and the valued kinds from the table', () => {
    expect([...DIMENSION_KINDS]).toEqual([
      'linear',
      'aligned',
      'ordinate',
      'radius',
      'diameter',
      'angle',
      'chamfer',
    ]);
    const valued = ANNOTATION_KINDS.filter(isValuedKind);
    expect(valued).toEqual([...DIMENSION_KINDS, 'holeCallout']);
  });

  it('reads describe and expression fields through the table', () => {
    const note = { id: 'a', kind: 'note', refs: [], text: 'x' } as never;
    expect(describeAnnotation(note)).toBe('note');
    expect(annotationExprFields(note)).toEqual([]);
    const angle = {
      id: 'b',
      kind: 'angle',
      refs: [],
      nominal: '30 deg',
      tolerance: { kind: 'symmetric', value: '1 deg' },
    } as never;
    expect(annotationExprFields(angle)).toEqual([
      { pointer: '/nominal', expected: 'angle' },
      { pointer: '/tolerance/value', expected: 'angle' },
    ]);
    // Malformed input names no fields instead of throwing.
    expect(annotationExprFields({ kind: 'bogus' } as never)).toEqual([]);
    expect(annotationExprFields({ kind: 'toString' } as never)).toEqual([]);
  });
});
