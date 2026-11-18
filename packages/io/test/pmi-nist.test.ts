// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * M5a (ADR-100): the NIST MBE PMI test models (packages/test-fixtures/step/nist/, public NIST
 * data, see its README) are AP242 files with semantic and presentation PMI, and the census sees
 * it. Reading them into annotations needs the kernel façade's PMI reader: that test is in
 * packages/kernel-client (FACADE-PMI-PENDING).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { hasStepPmi, stepPmiCensus } from '../src/pmi';

const dir = fileURLToPath(new URL('../../test-fixtures/step/nist/', import.meta.url));
const read = (name: string) => gunzipSync(new Uint8Array(readFileSync(`${dir}${name}.gz`)));

/** Entity counts as found in the files (re-count if a fixture is replaced). */
const EXPECTED: Record<string, { dimensions: number; tolerances: number; datums: number }> = {
  'nist_ctc_01_asme1_ap242-e1.stp': { dimensions: 12, tolerances: 6, datums: 3 },
  'nist_ctc_03_asme1_ap242-e2.stp': { dimensions: 10, tolerances: 13, datums: 6 },
  'nist_ctc_05_asme1_ap242-e1.stp': { dimensions: 6, tolerances: 10, datums: 4 },
  'nist_stc_06_asme1_ap242-e3.stp': { dimensions: 17, tolerances: 25, datums: 6 },
};

describe('NIST MBE PMI test models', () => {
  for (const [name, want] of Object.entries(EXPECTED)) {
    it(`${name}: AP242 with semantic and presentation PMI`, () => {
      const c = stepPmiCensus(read(name));
      expect(c.schemas.join(' ')).toMatch(/AP242/);
      expect({ dimensions: c.dimensions, tolerances: c.tolerances, datums: c.datums }).toEqual(
        want,
      );
      expect(c.presentation).toBeGreaterThan(0);
      expect(hasStepPmi(c)).toBe(true);
    });
  }

  it('a STEP file without PMI has none', () => {
    const plain = new TextEncoder().encode(
      "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n",
    );
    const c = stepPmiCensus(plain);
    expect(c.schemas).toEqual(['AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }']);
    expect(hasStepPmi(c)).toBe(false);
  });
});
