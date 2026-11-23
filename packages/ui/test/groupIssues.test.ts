import { describe, expect, it } from 'vitest';
import { groupIssues, severityCounts } from '../src';

describe('groupIssues', () => {
  it('groups by code, falls back to reason, and counts', () => {
    const g = groupIssues([
      { label: 'a', reason: 'one', code: 'x' },
      { label: 'b', reason: 'a different wording', code: 'x' },
      { label: 'c', reason: 'solo' },
      { label: 'd', reason: 'solo' },
      { label: 'e', reason: 'other' },
    ]);
    expect(g.map((x) => [x.key, x.count, x.labels])).toEqual([
      ['x', 2, ['a', 'b']],
      ['solo', 2, ['c', 'd']],
      ['other', 1, ['e']],
    ]);
    expect(g[0]?.reason).toBe('one');
  });

  it('orders lost, approximated, cosmetic; a missing severity is lost', () => {
    const g = groupIssues([
      { label: '1', reason: 'c', severity: 'cosmetic' },
      { label: '2', reason: 'c', severity: 'cosmetic' },
      { label: '3', reason: 'c', severity: 'cosmetic' },
      { label: '4', reason: 'a', severity: 'approximated' },
      { label: '5', reason: 'l' },
    ]);
    expect(g.map((x) => x.severity)).toEqual(['lost', 'approximated', 'cosmetic']);
  });

  it('within a severity the larger group comes first; a group takes its worst severity', () => {
    const g = groupIssues([
      { label: '1', reason: 'small' },
      { label: '2', reason: 'big' },
      { label: '3', reason: 'big' },
      { label: '4', reason: 'mixed', code: 'm', severity: 'cosmetic' },
      { label: '5', reason: 'mixed', code: 'm', severity: 'approximated' },
    ]);
    expect(g.map((x) => x.key)).toEqual(['big', 'small', 'm']);
    expect(g[2]?.severity).toBe('approximated');
  });

  it('counts issues per severity', () => {
    expect(
      severityCounts([
        { label: '1', reason: 'a' },
        { label: '2', reason: 'a', severity: 'cosmetic' },
      ]),
    ).toEqual({ lost: 1, approximated: 0, cosmetic: 1 });
  });
});
