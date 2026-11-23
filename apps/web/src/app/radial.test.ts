import { describe, expect, it } from 'vitest';
import {
  MAX_RADIAL_ITEMS,
  modelRadialIds,
  RADIAL_ADD_FOLDER,
  RADIAL_EDIT_FEATURE,
  RADIAL_EDIT_SKETCH,
  sketchRadialIds,
  sketchToolOf,
} from './radial';

describe('radial contents', () => {
  it('never exceeds seven items (Repeat is the eighth slot)', () => {
    const sets = [
      modelRadialIds([]),
      modelRadialIds([], { folderable: true }),
      modelRadialIds([{ kind: 'face', planar: true }]),
      modelRadialIds([{ kind: 'face', planar: false }]),
      modelRadialIds([
        { kind: 'face', planar: true },
        { kind: 'face', planar: true },
      ]),
      modelRadialIds([{ kind: 'edge' }]),
      modelRadialIds([{ kind: 'vertex' }]),
      modelRadialIds([{ kind: 'region' }]),
      modelRadialIds([{ kind: 'edge' }, { kind: 'face' }]),
      sketchRadialIds(),
    ];
    for (const s of sets) {
      expect(s.length).toBeLessThanOrEqual(MAX_RADIAL_ITEMS);
      expect(new Set(s).size).toBe(s.length);
    }
  });

  it('one face: offers Edit feature and Edit sketch for what made it, within seven items', () => {
    const flat = [{ kind: 'face' as const, planar: true }];
    const round = [{ kind: 'face' as const, planar: false }];
    // Nothing known about the face: the ring is as it always was.
    expect(modelRadialIds(flat)).toEqual(
      modelRadialIds(flat, { owner: { feature: false, sketch: false } }),
    );
    const both = modelRadialIds(flat, { owner: { feature: true, sketch: true } });
    expect(both).toEqual([
      'sketch',
      'pushPull',
      'hole',
      'shell',
      'measure',
      RADIAL_EDIT_FEATURE,
      RADIAL_EDIT_SKETCH,
    ]);
    // Only a feature (a fillet face, a primitive): one item, so only Section gives way.
    const one = modelRadialIds(flat, { owner: { feature: true, sketch: false } });
    expect(one).toEqual([
      'sketch',
      'pushPull',
      'hole',
      'shell',
      'draft',
      'measure',
      RADIAL_EDIT_FEATURE,
    ]);
    expect(modelRadialIds(round, { owner: { feature: true, sketch: true } })).toEqual([
      'thread',
      'shell',
      'draft',
      'measure',
      RADIAL_EDIT_FEATURE,
      RADIAL_EDIT_SKETCH,
    ]);
    for (const r of [both, one]) expect(r.length).toBeLessThanOrEqual(MAX_RADIAL_ITEMS);
    // Never for several faces, edges or an empty selection.
    const owner = { feature: true, sketch: true };
    expect(modelRadialIds([...flat, ...flat], { owner })).not.toContain(RADIAL_EDIT_FEATURE);
    expect(modelRadialIds([{ kind: 'edge' }], { owner })).not.toContain(RADIAL_EDIT_FEATURE);
    expect(modelRadialIds([], { owner })).not.toContain(RADIAL_EDIT_SKETCH);
  });

  it('is chosen by what is selected', () => {
    expect(modelRadialIds([{ kind: 'face', planar: true }])).toContain('pushPull');
    expect(modelRadialIds([{ kind: 'face', planar: false }])).toContain('thread');
    expect(modelRadialIds([{ kind: 'edge' }])).toEqual(['fillet', 'chamfer', 'measure']);
    expect(modelRadialIds([{ kind: 'region' }])).toContain('extrude');
    expect(modelRadialIds([])).toContain('fit');
  });

  it('offers Add to new folder only when several tree features can be grouped', () => {
    expect(modelRadialIds([], { folderable: true })[0]).toBe(RADIAL_ADD_FOLDER);
    expect(modelRadialIds([], { folderable: false })).not.toContain(RADIAL_ADD_FOLDER);
    expect(modelRadialIds([])).not.toContain(RADIAL_ADD_FOLDER);
    // A viewport selection wins: the menu stays about the selected geometry.
    expect(modelRadialIds([{ kind: 'edge' }], { folderable: true })).toEqual([
      'fillet',
      'chamfer',
      'measure',
    ]);
  });

  it('maps sketch ids to tools', () => {
    expect(sketchToolOf('sketch:line')).toBe('line');
    expect(sketchToolOf('sketch:finish')).toBeNull();
    expect(sketchToolOf('pushPull')).toBeNull();
  });
});
