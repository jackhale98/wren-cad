// SPDX-License-Identifier: GPL-3.0-or-later
import { FEATURE_DEFS, KNOWN_FEATURE_TYPES } from '@wren-cad/document';
import { featureMeta, featureValueLabel, isReferenceType } from '@wren-cad/ui';
import { describe, expect, it } from 'vitest';

// ui cannot import the document package, so it keeps its own complete tables (display name and
// icon, value labels, reference types). This is the one place that sees both sides.
describe('feature kind tables outside the document package', () => {
  it('ui names every feature kind as the definition table does', () => {
    for (const k of KNOWN_FEATURE_TYPES) expect(featureMeta[k].label).toBe(FEATURE_DEFS[k].label);
  });

  it('ui labels every value the way the definition table does', () => {
    for (const k of KNOWN_FEATURE_TYPES) {
      for (const [pointer, label] of Object.entries(FEATURE_DEFS[k].valueLabels)) {
        expect(featureValueLabel(pointer), `${k} ${pointer}`).toBe(label);
      }
    }
  });

  it('ui and the table agree on which kinds are reference geometry', () => {
    for (const k of KNOWN_FEATURE_TYPES) {
      expect(isReferenceType(k), k).toBe(FEATURE_DEFS[k].isReference);
    }
  });
});
