/**
 * A short tap of Before: the rolled-back regen requested for it may still be running when the
 * key is released. Its result must not replace the real statuses, the restored result or the
 * selection (it shows geometry that does not exist with the feature).
 */
import type { WrenDoc } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { onRegen } from './regen-view';
import type { RegenView } from './state';
import { viewDoc } from './view-doc';
import type { Workbench } from './workbench';

const doc = {
  parts: [{ id: 'P', rollbackIndex: 2, features: [{ id: 'A' }, { id: 'B' }] }],
} as unknown as WrenDoc;

const viewFor = (d: WrenDoc): RegenView =>
  ({
    source: 'live',
    quality: 'coarse',
    doc: d,
    result: {
      partId: 'P',
      revision: 1,
      features: [],
      bodies: [],
      sketches: [],
      totalMs: 1,
      cache: { hits: 0, misses: 0 },
    },
  }) as unknown as RegenView;

function setup() {
  const ui = { before: true, featureId: 'B' as string | null, picking: null, sketch: null };
  const calls: string[] = [];
  const wb = {
    ui: { get: () => ui },
    config: {
      resolved: () => ({ doc, issues: [] }),
      isCurrent: (d: unknown) => d === doc,
      activeName: undefined,
      onRegenResult: () => {},
      onSettled: () => {},
    },
    viewMemo: null,
    pickAccepts: () => null,
    treeStatuses: { set: () => calls.push('statuses') },
    regen: { set: () => calls.push('regen') },
    remapSelection: () => calls.push('remap'),
    syncViewport: () => calls.push('sync'),
    keepInView: () => {},
    sketch: null,
    firstRendered: true,
    policy: { meshQuality: 'coarse' },
    updateMeshCache: () => {},
    pushPull: { onRegen: () => {} },
    measure: { onRegen: () => {} },
    syncSection: () => {},
  } as unknown as Workbench;
  (wb as { viewDoc: () => WrenDoc }).viewDoc = () => viewDoc(wb);
  return { wb, ui, calls };
}

describe('a superseded Before result', () => {
  it('is dropped when Before was released while its regen ran', () => {
    const { wb, ui, calls } = setup();
    const rolled = viewDoc(wb); // the request made for Before
    expect(rolled).not.toBe(doc);
    ui.before = false; // released before the answer came back
    onRegen(wb, viewFor(rolled));
    expect(calls).toEqual([]);
  });

  it('is applied while Before is still held (and does not remap the selection)', () => {
    const { wb, calls } = setup();
    onRegen(wb, viewFor(viewDoc(wb)));
    expect(calls).toContain('regen');
    expect(calls).not.toContain('remap');
  });

  it('does not affect the real result', () => {
    const { wb, ui, calls } = setup();
    viewDoc(wb);
    ui.before = false;
    onRegen(wb, viewFor(doc));
    expect(calls).toEqual(expect.arrayContaining(['statuses', 'regen', 'remap']));
  });
});
