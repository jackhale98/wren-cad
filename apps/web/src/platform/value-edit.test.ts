import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './tier-policy';
import { inlineFeatureValues, paramsModeFor } from './value-edit';

const off = { fullEditor: false };

describe('value editing gates (ADR-101)', () => {
  it('phone review: the full parameter table (as before Phase 2), inline feature values', () => {
    const c = capabilitiesFor('phone', off);
    expect(paramsModeFor(c)).toBe('edit');
    expect(inlineFeatureValues(c)).toBe(true);
  });
  it('phone with the full editor, tablet and desktop: the full table, no inline values pane', () => {
    for (const c of [
      capabilitiesFor('phone', { fullEditor: true }),
      capabilitiesFor('tablet', off),
      capabilitiesFor('desktop', off),
    ]) {
      expect(paramsModeFor(c)).toBe('edit');
      expect(inlineFeatureValues(c)).toBe(false);
    }
  });
  it('a device without editValues views only', () => {
    const c = { ...capabilitiesFor('phone', off), editValues: false };
    expect(paramsModeFor(c)).toBe('view');
    expect(inlineFeatureValues(c)).toBe(false);
  });
});
