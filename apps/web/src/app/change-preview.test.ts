/**
 * Change preview (ADR-103): the tint follows the displayed result and is gone when editing ends,
 * on undo and when the feature errors; the extrude volume shows before the kernel answers and is
 * replaced by the real result; Before changes nothing in the document.
 */
import type { FeatureStatus, MeshBuffers } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { ChangePreview } from './change-preview';
import type { RegenView } from './state';
import type { Workbench } from './workbench';

interface Call {
  kind: 'tint' | 'prism' | 'solid';
  arg: unknown;
}

const status = (featureId: string, state: FeatureStatus['state'] = 'ok'): FeatureStatus =>
  ({ featureId, state, cached: false }) as FeatureStatus;

const viewOf = (
  doc: unknown,
  faceNames: string[],
  states: Record<string, FeatureStatus['state']> = {},
  sketches: unknown[] = [],
): RegenView =>
  ({
    source: 'live',
    quality: 'fine',
    doc,
    result: {
      partId: 'P',
      revision: 1,
      features: ['A', 'B'].map((id) => status(id, states[id] ?? 'ok')),
      bodies: [{ id: 'BA', shape: 1, mesh: { faceNames } as unknown as MeshBuffers }],
      sketches,
      totalMs: 1,
      cache: { hits: 0, misses: 0 },
    },
  }) as unknown as RegenView;

function setup() {
  const calls: Call[] = [];
  const features = [
    { id: 'A', type: 'extrude', op: 'add', suppressed: false, name: 'Extrude' },
    { id: 'B', type: 'fillet', suppressed: false, name: 'Fillet' },
  ];
  const doc = { parts: [{ id: 'P', features, rollbackIndex: 2 }] };
  const ui = { featureId: 'B' as string | null, sketch: null, pushPull: null, before: false };
  const state = {
    view: viewOf(doc, ['FA:start', 'FB:fillet(edge(x))', 'FB:fillet(edge(y))']),
    viewDoc: doc as unknown,
    synced: 0,
  };
  const wb = {
    regen: {
      get: () => state.view,
      set: (v: RegenView) => {
        state.view = v;
      },
    },
    ui: { get: () => ui },
    patchUi: (p: Partial<typeof ui>) => Object.assign(ui, p),
    viewport: {
      setFeatureTint: (arg: unknown) => calls.push({ kind: 'tint', arg }),
      setRegionPrism: (arg: unknown) => calls.push({ kind: 'prism', arg }),
      setFeatureSolid: (arg: unknown) => calls.push({ kind: 'solid', arg }),
    },
    viewDoc: () => state.viewDoc,
    evaluate: () => ({ ok: true, value: 10 }),
    part: doc.parts[0],
    syncViewport: () => {
      state.synced++;
    },
  } as unknown as Workbench;
  const cp = new ChangePreview(wb);
  const last = (kind: Call['kind']) => calls.filter((c) => c.kind === kind).at(-1)?.arg;
  return { cp, calls, ui, state, doc, last, features, wb };
}

describe('feature tint', () => {
  it('tints the fillet faces as modify while the fillet is edited', () => {
    const { cp, last } = setup();
    cp.sync();
    expect(last('tint')).toEqual({ effect: 'modify', faces: [{ bodyId: 'BA', faces: [1, 2] }] });
    expect(cp.state().tint).toEqual({ featureId: 'B', effect: 'modify', faces: 2 });
  });

  it('tints an extrude as add and an extruded cut as cut', () => {
    const s = setup();
    s.ui.featureId = 'A';
    s.cp.sync();
    expect(s.last('tint')).toMatchObject({ effect: 'add', faces: [{ faces: [0] }] });
    (s.features[0] as { op: string }).op = 'cut';
    s.state.view = viewOf(s.doc, ['FA:start']);
    s.cp.sync();
    expect(s.last('tint')).toMatchObject({ effect: 'cut' });
  });

  it('is cleared when editing ends', () => {
    const { cp, ui, last } = setup();
    cp.sync();
    ui.featureId = null;
    cp.sync();
    expect(last('tint')).toBeNull();
    expect(cp.state().tint).toBeNull();
  });

  it('is cleared when the feature errors, and while a sketch or push/pull is open', () => {
    const s = setup();
    s.cp.sync();
    s.state.view = viewOf(s.doc, ['FA:start'], { B: 'error' });
    s.cp.sync();
    expect(s.last('tint')).toBeNull();
    s.state.view = viewOf(s.doc, ['FA:start', 'FB:fillet(e)']);
    s.cp.sync();
    expect(s.cp.state().tint?.faces).toBe(1);
    (s.ui as { sketch: unknown }).sketch = {};
    s.cp.sync();
    expect(s.cp.state().tint).toBeNull();
  });

  it('is cleared on undo and comes back only with the next result', () => {
    const s = setup();
    s.cp.sync();
    s.cp.clear();
    expect(s.last('tint')).toBeNull();
    s.cp.sync(); // the old result is still on screen: not tinted again
    expect(s.cp.state().tint).toBeNull();
    s.state.view = viewOf(s.doc, ['FA:start', 'FB:fillet(e)']);
    s.cp.sync();
    expect(s.cp.state().tint?.faces).toBe(1);
  });

  it('only tints a live result', () => {
    const s = setup();
    s.state.view = { ...s.state.view, source: 'cache' } as RegenView;
    s.cp.sync();
    expect(s.cp.state().tint).toBeNull();
  });

  it('does not push to the viewport again while nothing changed', () => {
    const s = setup();
    s.cp.sync();
    const n = s.calls.length;
    s.cp.sync();
    s.cp.sync();
    expect(s.calls.length).toBe(n);
  });
});

describe('extrude volume before the kernel answers', () => {
  const extrude = {
    id: 'A',
    type: 'extrude',
    name: 'Extrude',
    suppressed: false,
    profile: [{ name: 'R1', kind: 'region' }],
    direction: 'normal',
    end: { kind: 'blind', depth: '10 mm' },
    op: 'add',
  };
  const sketches = [
    {
      featureId: 'SK',
      regions: [
        {
          name: 'R1',
          mesh: { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) },
        },
      ],
      frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
    },
  ];
  const withPending = () => {
    const s = setup();
    s.ui.featureId = 'A';
    s.state.view = viewOf(s.doc, ['FA:start'], {}, sketches);
    s.state.viewDoc = { parts: [{ ...s.doc.parts[0] }] }; // the edit made a newer document
    return s;
  };

  it('appears at once, and the real result replaces it', () => {
    const s = withPending();
    s.cp.onFeature(extrude as never);
    expect(s.last('prism')).toMatchObject({ distance: 10, effect: 'add', direction: [0, 0, 1] });
    expect(s.cp.state().prism).toMatchObject({ featureId: 'A', distance: 10 });
    s.cp.sync(); // the displayed result is still of the old document
    expect(s.cp.state().prism).not.toBeNull();
    s.state.view = viewOf(s.state.viewDoc, ['FA:start'], {}, sketches); // the kernel answered
    s.cp.sync();
    expect(s.cp.state().prism).toBeNull();
    expect(s.last('prism')).toBeNull();
  });

  it('is dropped when editing ends and on undo', () => {
    const s = withPending();
    s.cp.onFeature(extrude as never);
    s.ui.featureId = null;
    s.cp.sync();
    expect(s.cp.state().prism).toBeNull();
    s.ui.featureId = 'A';
    s.cp.onFeature(extrude as never);
    s.cp.clear();
    expect(s.cp.state().prism).toBeNull();
  });

  it('shows nothing for an up-to end or a non-extrude feature', () => {
    const s = withPending();
    s.cp.onFeature({
      ...extrude,
      end: { kind: 'upTo', target: { name: 'x', kind: 'face' } },
    } as never);
    expect(s.cp.state().prism).toBeNull();
    s.cp.onFeature({ id: 'B', type: 'fillet' } as never);
    expect(s.cp.state().prism).toBeNull();
  });

  it('shows nothing when the displayed result already is the current document', () => {
    const s = setup();
    s.ui.featureId = 'A';
    s.state.view = viewOf(s.state.viewDoc, ['FA:start'], {}, sketches);
    s.cp.onFeature(extrude as never);
    expect(s.cp.state().prism).toBeNull();
  });
});

describe('the exact solid the feature adds or removes (slice 2e.2)', () => {
  const mesh = (n: number) =>
    ({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), n }) as never;
  const previewOf = (featureId: string, effect: 'add' | 'cut' = 'cut') => ({
    featureId,
    effect,
    shows: effect === 'cut' ? ('removed' as const) : ('tool' as const),
    meshes: [mesh(1)],
    volume: 123.5,
  });
  /** Editing extrude A; the result on screen carries its preview. */
  const editing = (preview: unknown = previewOf('A')) => {
    const s = setup();
    s.ui.featureId = 'A';
    const withPreview = (doc: unknown, p: unknown, states = {}): RegenView => {
      const v = viewOf(doc, ['FA:start'], states);
      return p ? ({ ...v, result: { ...v.result, preview: p } } as RegenView) : v;
    };
    s.state.view = withPreview(s.doc, preview);
    return { ...s, withPreview };
  };

  it('is drawn with the result that carries it, in its effect colour', () => {
    const s = editing();
    s.cp.sync();
    expect(s.last('solid')).toMatchObject({ effect: 'cut' });
    expect((s.last('solid') as { meshes: unknown[] }).meshes).toHaveLength(1);
    expect(s.cp.state().solid).toEqual({
      featureId: 'A',
      effect: 'cut',
      shows: 'removed',
      volume: 123.5,
      meshes: 1,
    });
  });

  it('a new result replaces it; a result without one (the feature errors) removes it', () => {
    const s = editing();
    s.cp.sync();
    const next = { ...previewOf('A'), volume: 200 };
    s.state.view = s.withPreview(s.doc, next);
    s.cp.sync();
    expect(s.cp.state().solid?.volume).toBe(200);
    // The feature errors with the next value: the engine sends no preview, the old one goes.
    s.state.view = s.withPreview(s.doc, null, { A: 'error' });
    s.cp.sync();
    expect(s.last('solid')).toBeNull();
    expect(s.cp.state().solid).toBeNull();
  });

  it('is gone when editing ends, another feature is edited, or a sketch or push/pull opens', () => {
    const s = editing();
    s.cp.sync();
    s.ui.featureId = null;
    s.cp.sync();
    expect(s.last('solid')).toBeNull();
    s.ui.featureId = 'A';
    s.cp.sync();
    expect(s.cp.state().solid).not.toBeNull();
    s.ui.featureId = 'B'; // the result's preview is of A
    s.cp.sync();
    expect(s.cp.state().solid).toBeNull();
    s.ui.featureId = 'A';
    (s.ui as { pushPull: unknown }).pushPull = {};
    s.cp.sync();
    expect(s.cp.state().solid).toBeNull();
  });

  it('is cleared on undo and comes back only with the next result', () => {
    const s = editing();
    s.cp.sync();
    s.cp.clear();
    expect(s.last('solid')).toBeNull();
    s.cp.sync(); // the old result is still on screen
    expect(s.cp.state().solid).toBeNull();
    s.state.view = s.withPreview(s.doc, previewOf('A'));
    s.cp.sync();
    expect(s.cp.state().solid).not.toBeNull();
  });

  it('Before hides it and the release shows the same solid again', () => {
    const s = editing();
    s.cp.sync();
    const shown = s.last('solid');
    s.cp.setBefore(true);
    expect(s.last('solid')).toBeNull();
    expect(s.cp.state().solid).toBeNull();
    // The rolled-back result arrives while the key is held: still nothing.
    const stash = s.state.view;
    s.state.view = s.withPreview(s.doc, null, { A: 'rolledBack' });
    s.cp.sync();
    expect(s.cp.state().solid).toBeNull();
    s.state.view = stash;
    (s.wb as { syncViewport: () => void }).syncViewport = () => s.cp.sync();
    s.cp.setBefore(false);
    expect(s.last('solid')).toEqual(shown);
  });

  it('only a live result has one; a rolled-back feature has none', () => {
    const s = editing();
    s.state.view = { ...s.state.view, source: 'cache' } as RegenView;
    s.cp.sync();
    expect(s.cp.state().solid).toBeNull();
  });

  it('the extrude prism stands in until the regen of the new value arrives', () => {
    const s = editing();
    const sketches = [
      {
        featureId: 'SK',
        regions: [
          {
            name: 'R1',
            mesh: { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) },
          },
        ],
        frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
      },
    ];
    s.state.view = {
      ...s.state.view,
      result: { ...s.state.view.result, sketches },
    } as unknown as RegenView;
    s.cp.sync();
    expect(s.cp.state().solid).not.toBeNull();
    // A new depth: a newer document, the prism is up at once and the old solid is not shown with it.
    s.state.viewDoc = { parts: [{ ...s.doc.parts[0] }] };
    s.cp.onFeature({
      id: 'A',
      type: 'extrude',
      name: 'Extrude',
      suppressed: false,
      profile: [{ name: 'R1', kind: 'region' }],
      direction: 'normal',
      end: { kind: 'blind', depth: '10 mm' },
      op: 'cut',
    } as never);
    expect(s.cp.state().prism).not.toBeNull();
    expect(s.cp.state().solid).toBeNull();
    expect(s.last('solid')).toBeNull();
    // The regen of that document: the prism goes, the exact solid of the new value shows.
    const next = { ...previewOf('A'), volume: 77 };
    s.state.view = s.withPreview(s.state.viewDoc, next);
    s.cp.sync();
    expect(s.cp.state().prism).toBeNull();
    expect(s.cp.state().solid?.volume).toBe(77);
  });

  it('does not push the same solid again', () => {
    const s = editing();
    s.cp.sync();
    const n = s.calls.filter((c) => c.kind === 'solid').length;
    // Mass properties arrive: a new view object around the same result data.
    s.state.view = { ...s.state.view, result: { ...s.state.view.result } } as RegenView;
    s.cp.sync();
    s.cp.sync();
    expect(s.calls.filter((c) => c.kind === 'solid').length).toBe(n);
  });

  it('asks the regen for the solid of the edited feature only where a solid exists', () => {
    const s = editing();
    expect(s.cp.requestId()).toBe('A');
    s.ui.featureId = 'B'; // a fillet
    expect(s.cp.requestId()).toBeNull();
    s.ui.featureId = null;
    expect(s.cp.requestId()).toBeNull();
    s.ui.featureId = 'A';
    s.ui.before = true;
    expect(s.cp.requestId()).toBeNull();
    s.ui.before = false;
    (s.ui as { sketch: unknown }).sketch = {};
    expect(s.cp.requestId()).toBeNull();
    (s.ui as { sketch: unknown }).sketch = null;
    (s.features[0] as { suppressed: boolean }).suppressed = true;
    expect(s.cp.requestId()).toBeNull();
  });
});

describe('Before', () => {
  it('shows the model without the feature, then restores the same result on release', () => {
    const s = setup();
    s.cp.sync();
    const shown = s.state.view;
    s.cp.setBefore(true);
    expect(s.ui.before).toBe(true);
    expect(s.cp.state().tint).toBeNull(); // nothing of the feature is tinted
    s.cp.setBefore(false);
    expect(s.ui.before).toBe(false);
    expect(s.state.view).toBe(shown); // restored in the same frame, no kernel round trip
    expect(s.state.synced).toBe(1);
  });

  it('is only offered while a feature that has something before it is open', () => {
    const s = setup();
    s.ui.featureId = null;
    s.cp.setBefore(true);
    expect(s.ui.before).toBe(false);
    s.ui.featureId = 'A';
    expect(s.cp.canShowBefore()).toBe(true);
    (s.ui as { sketch: unknown }).sketch = {};
    expect(s.cp.canShowBefore()).toBe(false);
  });

  it('changes nothing in the document', () => {
    const s = setup();
    const before = JSON.stringify(s.doc);
    s.cp.setBefore(true);
    s.cp.setBefore(false);
    expect(JSON.stringify(s.doc)).toBe(before);
  });
});
