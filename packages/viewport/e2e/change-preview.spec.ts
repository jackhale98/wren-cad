import { expect, test } from '@playwright/test';
import { boxMesh } from '@wren-cad/test-fixtures';
import { dist, frame, open, samplePoints } from './helpers';

const Q = '?backend=webgl2&reducedMotion=1';
const TOP = boxMesh(1, 1, 1).faceNames.indexOf('face.zmax');

/** Change preview (ADR-103): tinted faces by effect, and the swept volume of a profile region. */
test.describe('change preview', () => {
  test('tinted faces follow the effect and clear; a region prism is a uniform write', async ({
    page,
  }) => {
    await open(page, Q);
    await page.evaluate(() => window.__viewport?.viewport.setView('iso', false));
    await frame(page);
    const at = (p: [number, number, number]) =>
      page.evaluate((q) => window.__viewport?.viewport.worldToScreen(q), p);
    const top = (await at([20, 15, 20])) as { x: number; y: number };
    const cap = (await at([20, 15, 36])) as { x: number; y: number };
    const [faceBefore, bgBefore] = await samplePoints(page, [
      [top.x, top.y],
      [cap.x, cap.y],
    ]);

    const tint = (effect: 'add' | 'cut' | 'modify' | null) =>
      page.evaluate(
        ([e, face]) => {
          const v = window.__viewport?.viewport;
          if (!v) throw new Error('no viewport');
          v.setFeatureTint(
            e ? { effect: e, faces: [{ bodyId: 'box', faces: [face as number] }] } : null,
          );
          return v.getTintStats();
        },
        [effect, TOP] as const,
      );

    expect(await tint('add')).toMatchObject({ effect: 'add', faces: 1 });
    await frame(page);
    const [added] = await samplePoints(page, [[top.x, top.y]]);
    // The light face takes the bluish green: red falls well below green.
    expect((added?.[1] ?? 0) - (added?.[0] ?? 0)).toBeGreaterThan(
      (faceBefore?.[1] ?? 0) - (faceBefore?.[0] ?? 0) + 30,
    );
    expect(dist(added ?? [0, 0, 0], faceBefore ?? [0, 0, 0])).toBeGreaterThan(15);

    expect(await tint('modify')).toMatchObject({ effect: 'modify' });
    await frame(page);
    const [modified] = await samplePoints(page, [[top.x, top.y]]);
    expect(dist(modified ?? [0, 0, 0], added ?? [0, 0, 0])).toBeGreaterThan(15); // another tint

    expect(await tint(null)).toMatchObject({ effect: null, faces: 0 });
    await frame(page);
    const [cleared] = await samplePoints(page, [[top.x, top.y]]);
    expect(dist(cleared ?? [0, 0, 0], faceBefore ?? [0, 0, 0])).toBeLessThan(3);

    // A region on the top face swept 18 mm: the add tint above the body, geometry built once.
    const stats = await page.evaluate(() => {
      const v = window.__viewport?.viewport;
      if (!v) throw new Error('no viewport');
      const region = {
        positions: new Float32Array([5, 5, 20, 35, 5, 20, 35, 25, 20, 5, 25, 20]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      } as never;
      const spec = (distance: number) => ({
        regions: [region],
        direction: [0, 0, 1] as [number, number, number],
        distance,
        effect: 'add' as const,
      });
      v.setRegionPrism(spec(18));
      const first = v.getTintStats().prism;
      for (let i = 0; i < 50; i++) v.setRegionPrism(spec(18 + i * 0.1));
      return { first, last: v.getTintStats().prism };
    });
    expect(stats.first).toMatchObject({ effect: 'add', distance: 18, builds: 1 });
    expect(stats.last).toMatchObject({ builds: 1 });
    await frame(page);
    const [prism] = await samplePoints(page, [[cap.x, cap.y]]);
    expect(prism?.[1]).toBeGreaterThan((prism?.[0] ?? 0) + 30); // green-dominant add tint
    expect(dist(prism ?? [0, 0, 0], bgBefore ?? [0, 0, 0])).toBeGreaterThan(30);

    await page.evaluate(() => window.__viewport?.viewport.setRegionPrism(null));
    await frame(page);
    const [gone] = await samplePoints(page, [[cap.x, cap.y]]);
    expect(dist(gone ?? [0, 0, 0], bgBefore ?? [0, 0, 0])).toBeLessThan(3);
  });
});
