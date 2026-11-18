/**
 * The drawing controller's build life cycle around drags (ADR-094): a build never lands under a
 * held drag, needless regen notifications rebuild nothing, and `ensureExact` waits for queued work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observable } from '../app/observable';
import type { Workbench } from '../app/workbench';
import { DrawingController, regenInputKey } from './controller';
import type { DrawingKernel } from './kernel';
import type { Built, PipelineResult } from './pipeline';

vi.mock('../doc/drawing-support', () => ({ ensureDrawingSupport: async () => {} }));

/** Every `runPipeline` call, each resolved by the test when it chooses. */
const calls: { quality: string; resolve(r: PipelineResult): void }[] = [];
vi.mock('./pipeline', () => ({
  runPipeline: (_doc: unknown, _id: unknown, _src: unknown, _k: unknown, quality: string) =>
    new Promise<PipelineResult>((resolve) => calls.push({ quality, resolve })),
}));

const builtOf = (quality: 'draft' | 'exact', doc: unknown = {}): PipelineResult =>
  ({
    kind: 'ok',
    built: {
      quality,
      drawing: (doc as { drawings?: unknown[] }).drawings?.[0] ?? {
        id: 'D',
        sheets: [{ id: 'S' }],
      },
      main: { doc },
    } as unknown as Built,
  }) as PipelineResult;

type View = NonNullable<ReturnType<Workbench['regen']['get']>>;
const regenOf = (doc: unknown, massKg?: number): View =>
  ({
    source: 'live',
    quality: 'fine',
    doc,
    result: {
      partId: 'P',
      revision: 1,
      features: [],
      bodies:
        massKg === undefined
          ? []
          : [
              {
                id: 'b',
                shape: 1,
                massProperties: { mass: massKg, volume: 1, area: 1, centroid: [0, 0, 0] },
              },
            ],
      sketches: [],
      totalMs: 0,
      cache: { hits: 0, misses: 0 },
    },
  }) as unknown as View;

function harness() {
  const doc = { parts: [], drawings: [{ id: 'D', sheets: [{ id: 'S' }] }] };
  const wb = {
    doc,
    regen: observable<View | null>(null),
    subscribeDoc: () => () => {},
    viewDoc: () => doc,
    part: undefined,
  } as unknown as Workbench;
  const kernel: DrawingKernel = {
    project: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'unused' } }),
    dispose: () => {},
  };
  const c = new DrawingController(wb, kernel);
  c.patch({ drawingId: 'D', phase: 'drawing' });
  return { c, wb, doc };
}

/** Runs the timers and the promise callbacks they start. */
const tick = async () => {
  await vi.advanceTimersByTimeAsync(20);
};

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('builds and drags (ADR-094)', () => {
  it('a build that started before the press and finishes mid-drag is not delivered; it is made again on release', async () => {
    const { c } = harness();
    c.schedule(0);
    await tick();
    expect(calls).toHaveLength(1);
    // The press: the drag holds builds. The build in flight finishes while the drag is on.
    c.hold();
    calls[0]?.resolve(builtOf('draft'));
    await tick();
    expect(c.builds).toBe(0);
    expect(c.built()).toBeNull();
    // Edits and regens during the drag queue nothing visible either.
    c.schedule(0);
    await tick();
    expect(calls).toHaveLength(1);
    expect(c.builds).toBe(0);
    // Release: the held-back build is made again from the document as it is now.
    c.resume();
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]?.resolve(builtOf('draft'));
    await tick();
    expect(c.builds).toBe(1);
  });

  it('a regen that changes nothing the drawing reads rebuilds nothing; a changed model or mass does', async () => {
    const { c, wb, doc } = harness();
    c.start();
    wb.regen.set(regenOf(doc));
    await tick();
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(builtOf('draft'));
    await tick();
    // The same model again (a fine pass, a mass fetch that found nothing new, a drawing-only
    // edit regenerated from the cache): no build.
    wb.regen.set(regenOf(doc));
    wb.regen.set({ ...regenOf(doc), quality: 'coarse' } as View);
    await tick();
    expect(calls).toHaveLength(1);
    // The mass arrives: the title block shows it, so the drawing is built again.
    wb.regen.set(regenOf(doc, 1.25));
    await tick();
    expect(calls).toHaveLength(2);
    expect(regenInputKey(regenOf(doc, 1.25))).not.toBe(regenInputKey(regenOf(doc)));
    // Another model: built again.
    const other = { ...doc, parts: [{ id: 'P', features: [] }] };
    expect(regenInputKey(regenOf(other))).not.toBe(regenInputKey(regenOf(doc)));
    c.dispose();
  });

  it('ensureExact waits for a queued build even when the exact edges are on screen', async () => {
    const { c, wb, doc } = harness();
    wb.regen.set(regenOf(doc));
    c.schedule(0, true);
    await tick();
    calls[0]?.resolve(builtOf('exact', doc));
    await tick();
    expect(c.builds).toBe(1);
    // A rebuild is queued (an edit): the exact edges on screen are about to be replaced.
    c.schedule(16);
    const done = c.ensureExact();
    let resolved = false;
    void done.then(() => {
      resolved = true;
    });
    await tick();
    expect(resolved).toBe(false);
    // It asked for the exact edges itself, and resolves once they are delivered.
    expect(calls.at(-1)?.quality).toBe('exact');
    calls.at(-1)?.resolve(builtOf('exact', doc));
    await tick();
    expect(resolved).toBe(true);
  });
});
