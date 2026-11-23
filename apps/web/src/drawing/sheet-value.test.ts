import { describe, expect, it } from 'vitest';
import { sheetValue } from './panels';

describe('the size the tolerance editor works from', () => {
  it('is the value the sheet draws, not the raw measurement', () => {
    // Reviewer, 2026-11-23: a stated 25 on geometry measuring 24.6. Limits typed as 25.1/24.9
    // must become deviations from 25 (+0.1/−0.1), not from 24.6 (+0.5/+0.3).
    expect(sheetValue({ value: 25, measured: 24.6 })).toBe(25);
  });
  it('falls back to the measurement, and to nothing', () => {
    expect(sheetValue({ measured: 24.6 })).toBe(24.6);
    expect(sheetValue({})).toBeUndefined();
    expect(sheetValue(undefined)).toBeUndefined();
  });
});
