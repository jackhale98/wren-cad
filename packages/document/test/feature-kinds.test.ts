// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CONFIGURABLE_OPTIONS,
  FEATURE_DEFS,
  fieldLabel,
  isReferenceType,
  KNOWN_FEATURE_TYPES,
} from '../src';

describe('FEATURE_DEFS', () => {
  it('has exactly one entry per known feature type, keyed by its own type', () => {
    expect(Object.keys(FEATURE_DEFS).sort()).toEqual([...KNOWN_FEATURE_TYPES].sort());
    for (const k of KNOWN_FEATURE_TYPES) expect(FEATURE_DEFS[k].type).toBe(k);
  });

  it('marks exactly plane, axis and point as reference geometry', () => {
    const refs = KNOWN_FEATURE_TYPES.filter((k) => FEATURE_DEFS[k].isReference);
    expect([...refs].sort()).toEqual(['axis', 'plane', 'point']);
    expect(isReferenceType('plane')).toBe(true);
    expect(isReferenceType('extrude')).toBe(false);
    expect(isReferenceType('toString')).toBe(false);
  });

  it('exposes configurable options only for kinds that have some', () => {
    const withOptions = KNOWN_FEATURE_TYPES.filter((k) => FEATURE_DEFS[k].options.length > 0);
    expect(Object.keys(CONFIGURABLE_OPTIONS).sort()).toEqual([...withOptions].sort());
    expect(CONFIGURABLE_OPTIONS.sketch).toBeUndefined();
  });

  it('labels a value from the kind, falling back to the last pointer segment', () => {
    expect(fieldLabel('extrude', '/end/depth')).toBe('Depth');
    expect(fieldLabel('hole', '/counterbore/depth')).toBe('Counterbore depth');
    expect(fieldLabel('sketch', '/constraints/3/value')).toBe('Value');
  });
});
