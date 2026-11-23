/**
 * The library thumbnail is the plain model: while a tint, swept volume or Before shows it is
 * skipped without being counted as taken, so the next save without them still takes it.
 */
import { describe, expect, it } from 'vitest';
import { thumbnail } from './files';
import type { Workbench } from './workbench';

function setup(showing: boolean) {
  const state = { showing, frames: 0 };
  const wb = {
    canvas: {},
    viewport: {
      nextFrame: () => {
        state.frames++;
        return Promise.resolve();
      },
    },
    shownBodies: new Set(['b']),
    ui: { get: () => ({ sketch: null }) },
    doc: { meta: { id: 'D' } },
    thumbDocs: new Set<string>(),
    thumbWanted: false,
    lastThumbAt: 0,
    changePreview: { showing: () => state.showing },
  } as unknown as Workbench;
  return { wb, state };
}

describe('thumbnail with a change preview', () => {
  it('skips while a preview or Before shows and leaves the first one due', async () => {
    const { wb, state } = setup(true);
    expect(await thumbnail(wb)).toBeUndefined();
    expect(state.frames).toBe(0);
    expect(wb.thumbDocs.has('D')).toBe(false);
  });

  it('is taken at the next save without one', async () => {
    const { wb, state } = setup(true);
    await thumbnail(wb);
    state.showing = false;
    await thumbnail(wb); // (no real canvas here: the read fails soft)
    expect(state.frames).toBe(1);
    expect(wb.thumbDocs.has('D')).toBe(true);
  });
});
