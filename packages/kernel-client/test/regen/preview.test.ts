/**
 * Change preview of the edited feature (ADR-103, slice 2e.2), engine unit tests on the scripted
 * fake kernel: which kernel calls the request adds, the cache key of the scratch entry, and that
 * the request changes nothing else. Volumes and solids are in preview.golden.test.ts.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Feature, Id, PrimitiveFeature } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { regenTransferables } from '../../src/regen/buffers';
import { RegenEngine, type RegenOutput } from '../../src/regen/engine';
import { previewKey, previewWalk } from '../../src/regen/preview';
import { FakeKernel, identitySolver } from './fake-kernel';
import { fid, makeDoc } from './helpers';

const PART = fid('PART');
const BOX = fid('BOX');
const TOOL = fid('TOOL');

type Box = Extract<PrimitiveFeature, { shape: 'box' }>;

function box(id: Id, op: Box['op'], dz: string, dx = '100 mm'): Box {
  return {
    id,
    type: 'primitive',
    name: 'Box',
    suppressed: false,
    op,
    shape: 'box',
    dx,
    dy: '50 mm',
    dz,
  };
}

function setup() {
  const kernel = new FakeKernel();
  const engine = new RegenEngine({
    kernel: kernel.api(),
    sketchSolver: async () => identitySolver,
  });
  const regen = (features: Feature[], preview?: Id, params: Record<string, string> = {}) =>
    engine.regenerate({
      doc: makeDoc(params, features, PART),
      partId: PART,
      quality: 'coarse',
      ...(preview === undefined ? {} : { preview: { featureId: preview } }),
    });
  /** Kernel calls for the tool feature, as `op` and whether a body was passed. */
  const calls = (from = 0) =>
    kernel.calls
      .slice(from)
      .filter((c) => c.feature.id === TOOL)
      .map((c) => `${(c.feature as Box).op}${c.inputs.target === undefined ? '' : '+body'}`);
  return { kernel, engine, regen, calls };
}

const strip = (r: RegenOutput) => {
  const { preview: _p, totalMs: _t, ...rest } = r;
  return {
    ...rest,
    features: rest.features.map(({ ms: _ms, ...f }) => f),
  };
};

describe('regen: change preview of the edited feature', () => {
  it('previewWalk reads the request; no request, no walk', () => {
    const doc = makeDoc({}, [], PART);
    const base = { doc, partId: PART, quality: 'coarse' as const };
    expect(previewWalk(base)).toBeNull();
    expect(previewWalk({ ...base, preview: { featureId: TOOL } })).toEqual({ featureId: TOOL });
    // Comlink callers are not type-checked.
    expect(previewWalk({ ...base, preview: { featureId: '' } })).toBeNull();
    expect(previewWalk({ ...base, preview: {} as { featureId: Id } })).toBeNull();
  });

  it('the scratch entry has a key of its own, derived from the feature key', () => {
    expect(previewKey('abc')).toBe(previewKey('abc'));
    expect(previewKey('abc')).not.toBe('abc');
    expect(previewKey('abc')).not.toBe(previewKey('abd'));
  });

  it('a cut: one more kernel call (the feature as intersect against the body before)', async () => {
    const { kernel, regen, calls } = setup();
    const features = [box(BOX, 'new', '20 mm'), box(TOOL, 'cut', '5 mm')];
    const plain = await regen(features);
    expect(plain.preview).toBeUndefined();
    // The real cut: the tool alone (bounding-box prefilter), then the cut on the body.
    expect(calls()).toEqual(['new', 'cut+body']);
    const before = kernel.calls.find((c) => c.feature.id === TOOL && c.inputs.target !== undefined)
      ?.inputs.target;

    const warm = await regen(features);
    let mark = kernel.calls.length;
    const r = await regen(features, TOOL);
    expect(r.cache).toEqual({ hits: 2, misses: 0 });
    expect(calls(mark)).toEqual(['intersect+body']);
    // Against the body as it was before the cut, with the cut's own values.
    const scratch = kernel.calls.at(-1);
    expect(scratch?.inputs.target).toBe(before);
    expect(scratch?.inputs.values).toEqual(
      kernel.calls.find((c) => c.feature.id === TOOL)?.inputs.values,
    );
    expect(scratch?.feature).toMatchObject({ id: TOOL, op: 'intersect' });
    expect((scratch?.feature as Box | undefined)?.scope).toBeUndefined();
    expect(r.preview).toMatchObject({ featureId: TOOL, effect: 'cut', shows: 'removed' });
    expect(r.preview?.meshes).toHaveLength(1);
    expect(r.preview?.meshes[0]?.faceNames).toEqual([]);
    expect(r.preview?.volume).toBe(100 * 50 * 5);
    // Everything else is what the same regen gives without the request.
    expect(strip(r)).toEqual({ ...strip(warm), revision: r.revision });

    // The same inputs: nothing is computed again.
    mark = kernel.calls.length;
    const again = await regen(features, TOOL);
    expect(kernel.calls.length).toBe(mark);
    expect(again.preview?.volume).toBe(r.preview?.volume);
    expect(again.preview?.meshes[0]?.positions.buffer).not.toBe(
      r.preview?.meshes[0]?.positions.buffer,
    );

    // A new value: the cut and its preview, once each.
    mark = kernel.calls.length;
    const edited = await regen([features[0] as Feature, box(TOOL, 'cut', '6 mm')], TOOL);
    expect(calls(mark)).toEqual(['new', 'cut+body', 'intersect+body']);
    expect(edited.preview?.volume).toBe(100 * 50 * 6);

    // Back to the earlier value: both come from the cache.
    mark = kernel.calls.length;
    const back = await regen(features, TOOL);
    expect(kernel.calls.length).toBe(mark);
    expect(back.preview?.volume).toBe(100 * 50 * 5);

    // An upstream edit changes the body the cut acts on: the preview is evaluated again.
    mark = kernel.calls.length;
    await regen([box(BOX, 'new', '25 mm'), features[1] as Feature], TOOL);
    expect(calls(mark)).toEqual(['new', 'cut+body', 'intersect+body']);
  });

  it('nothing extra runs without the request, or for another feature', async () => {
    const { kernel, regen } = setup();
    const features = [box(BOX, 'new', '20 mm'), box(TOOL, 'cut', '5 mm')];
    await regen(features);
    const mark = kernel.calls.length;
    await regen(features);
    expect((await regen(features, fid('NOPE'))).preview).toBeUndefined();
    expect(kernel.calls.length).toBe(mark);
  });

  it('intersect asks for the cut; add asks for the tool; a new body asks for nothing', async () => {
    const a = setup();
    const both = [box(BOX, 'new', '20 mm'), box(TOOL, 'intersect', '5 mm')];
    await a.regen(both);
    let mark = a.kernel.calls.length;
    const i = await a.regen(both, TOOL);
    expect(a.calls(mark)).toEqual(['cut+body']);
    expect(i.preview).toMatchObject({ effect: 'cut', shows: 'removed' });

    const b = setup();
    const add = [box(BOX, 'new', '20 mm'), box(TOOL, 'add', '5 mm')];
    await b.regen(add);
    mark = b.kernel.calls.length;
    const t = await b.regen(add, TOOL);
    expect(b.calls(mark)).toEqual(['new']);
    expect(t.preview).toMatchObject({ effect: 'add', shows: 'tool' });

    const c = setup();
    const fresh = [box(BOX, 'new', '20 mm'), box(TOOL, 'new', '5 mm')];
    await c.regen(fresh);
    mark = c.kernel.calls.length;
    const n = await c.regen(fresh, TOOL);
    expect(c.kernel.calls.length).toBe(mark);
    expect(n.preview).toMatchObject({ effect: 'add', shows: 'tool', volume: 100 * 50 * 5 });
    // The body's own solid is borrowed: no scratch entry, no handle of its own.
    expect(c.engine.stats(PART)).toEqual({ entries: 2, handles: 2 });
  });

  it('a failing scratch evaluation gives no preview and is not retried for the same inputs', async () => {
    const { kernel, engine, regen, calls } = setup();
    const features = [box(BOX, 'new', '20 mm'), box(TOOL, 'add', '5 mm')];
    await regen(features);
    const exec = kernel.execFeature.bind(kernel);
    kernel.execFeature = async (f, inputs) =>
      (f as Box).op === 'new' && f.id === TOOL
        ? { ok: false, error: { code: 'INVALID_INPUT', message: 'no tool without a body' } }
        : exec(f, inputs);
    let mark = kernel.calls.length;
    const r = await regen(features, TOOL);
    expect(r.features.map((f) => f.state)).toEqual(['ok', 'ok']);
    expect(r.preview).toBeUndefined();
    const handles = engine.stats(PART)?.handles;
    mark = kernel.calls.length;
    expect((await regen(features, TOOL)).preview).toBeUndefined();
    expect(calls(mark)).toEqual([]);
    expect(engine.stats(PART)?.handles).toBe(handles);
  });

  it('the feature not ok: no preview, and no kernel call for one', async () => {
    const { kernel, regen, calls } = setup();
    const features = [box(BOX, 'new', '20 mm'), box(TOOL, 'cut', '5 mm')];
    expect((await regen(features, TOOL)).preview).toBeDefined();
    kernel.failFor.add(TOOL);
    const mark = kernel.calls.length;
    const bad = await regen([features[0] as Feature, box(TOOL, 'cut', '7 mm')], TOOL);
    expect(bad.features[1]?.state).toBe('error');
    expect(bad.preview).toBeUndefined();
    expect(calls(mark).filter((c) => c.startsWith('intersect'))).toEqual([]);
  });

  it('the scratch solid is released with the part, and its mesh buffers are transferred', async () => {
    const { kernel, engine, regen } = setup();
    const features = [box(BOX, 'new', '20 mm'), box(TOOL, 'cut', '5 mm')];
    const r = await regen(features, TOOL);
    const buffers = regenTransferables(r);
    for (const m of r.preview?.meshes ?? []) {
      expect(buffers).toContain(m.positions.buffer);
      expect(buffers).toContain(m.indices.buffer);
      expect(buffers).toContain(m.edgePositions.buffer);
    }
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(engine.stats(PART)).toEqual({ entries: 3, handles: 3 });
    await engine.closePart(PART);
    expect(kernel.shapes.size).toBe(0);
    expect(engine.memoryStats().ownedHandles).toBe(0);
  });

  it('a spare budget of zero keeps the preview of the latest regen and drops earlier ones', async () => {
    const kernel = new FakeKernel();
    const engine = new RegenEngine({
      kernel: kernel.api(),
      sketchSolver: async () => identitySolver,
      options: { maxSpareResults: 0 },
    });
    const run = (dz: string) =>
      engine.regenerate({
        doc: makeDoc({}, [box(BOX, 'new', '20 mm'), box(TOOL, 'cut', dz)], PART),
        partId: PART,
        quality: 'coarse',
        preview: { featureId: TOOL },
      });
    await run('5 mm');
    expect(engine.stats(PART)).toEqual({ entries: 3, handles: 3 });
    const mark = kernel.calls.length;
    await run('5 mm');
    expect(kernel.calls.length).toBe(mark);
    await run('6 mm');
    expect(engine.stats(PART)).toEqual({ entries: 3, handles: 3 });
    expect(kernel.shapes.size).toBe(3);
  });
});
