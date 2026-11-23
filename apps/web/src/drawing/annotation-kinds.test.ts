// SPDX-License-Identifier: GPL-3.0-or-later
import { ANNOTATION_DEFS, ANNOTATION_KINDS } from '@wren-cad/document';
import { annotationKindName } from '@wren-cad/io/pmi';
import { describe, expect, it } from 'vitest';

// io, drawing and ui cannot import the document package, so they keep their own complete tables.
// This is the one place that sees both sides.
describe('annotation kind tables outside the document package', () => {
  it('io names every kind as the definition table does', () => {
    for (const k of ANNOTATION_KINDS) {
      expect(annotationKindName(k)).toBe(ANNOTATION_DEFS[k].exportName);
    }
  });
});
