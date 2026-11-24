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
  // Slice 2e.2: the exact solid the edited feature removes or adds, as `setFeatureSolid` draws it.
  test('the feature solid shows through the body, under highlights, and is cut by a section', async ({
    page,
  }) => {
    await open(page, Q);
    await page.evaluate(() => window.__viewport?.viewport.setView('iso', false));
    await frame(page);
    const at = (p: [number, number, number]) =>
      page.evaluate((q) => window.__viewport?.viewport.worldToScreen(q), p);
    // The harness solid is x 14-26, y 9-21, z 10-20: inside the 40 x 30 x 20 box, flush with its top.
    const over = (await at([20, 15, 20])) as { x: number; y: number };
    const away = (await at([34, 26, 20])) as { x: number; y: number };
    const pts: Array<[number, number]> = [
      [over.x, over.y],
      [away.x, away.y],
    ];
    const [plain, plainAway] = await samplePoints(page, pts);
    const stats = () => page.evaluate(() => window.__viewport?.viewport.getTintStats().solid);

    await page.evaluate(() => window.__viewport?.featureSolid('cut'));
    expect(await stats()).toMatchObject({
      effect: 'cut',
      meshes: 1,
      triangles: 12,
      builds: 1,
      clipped: true,
    });
    await frame(page);
    const [cut, cutAway] = await samplePoints(page, pts);
    // Vermillion over the light face: red stays, green and blue fall.
    expect((cut?.[0] ?? 0) - (cut?.[2] ?? 0)).toBeGreaterThan(
      (plain?.[0] ?? 0) - (plain?.[2] ?? 0) + 40,
    );
    expect(dist(cutAway ?? [0, 0, 0], plainAway ?? [0, 0, 0])).toBeLessThan(3); // only where it is

    // From below, the solid is behind 10 mm of the body: it still shows through.
    await page.evaluate(() => window.__viewport?.viewport.setView('bottom', false));
    await frame(page);
    const under = (await at([20, 15, 0])) as { x: number; y: number };
    await page.evaluate(() => window.__viewport?.featureSolid(null));
    await frame(page);
    const [bare] = await samplePoints(page, [[under.x, under.y]]);
    await page.evaluate(() => window.__viewport?.featureSolid('cut'));
    await frame(page);
    const [through] = await samplePoints(page, [[under.x, under.y]]);
    expect((through?.[0] ?? 0) - (through?.[2] ?? 0)).toBeGreaterThan(
      (bare?.[0] ?? 0) - (bare?.[2] ?? 0) + 20,
    );
    await page.evaluate(() => window.__viewport?.viewport.setView('iso', false));
    await frame(page);

    // The same buffers again: nothing is rebuilt. Another effect: the colour only.
    await page.evaluate(() => window.__viewport?.featureSolid('cut', undefined, false));
    expect((await stats())?.builds).toBe(2);
    await page.evaluate(() => window.__viewport?.featureSolid('add', undefined, false));
    expect(await stats()).toMatchObject({ effect: 'add', builds: 2 });
    await frame(page);
    const [added] = await samplePoints(page, [[over.x, over.y]]);
    expect((added?.[1] ?? 0) - (added?.[0] ?? 0)).toBeGreaterThan(30); // bluish green

    // A selected face draws over it: the top face turns toward the accent blue.
    await page.evaluate(
      (face) =>
        window.__viewport?.viewport.setHighlights({
          selected: [{ bodyId: 'box', kind: 'face', index: face }],
          preselected: [],
        }),
      TOP,
    );
    await frame(page);
    const [selected] = await samplePoints(page, [[over.x, over.y]]);
    expect((selected?.[2] ?? 0) - (added?.[2] ?? 0)).toBeGreaterThan(15);
    await page.evaluate(() =>
      window.__viewport?.viewport.setHighlights({ selected: [], preselected: [] }),
    );

    // A section that removes the half of the model the solid is in removes the solid with it.
    await page.evaluate(() => {
      window.__viewport?.featureSolid('cut', undefined, false);
      window.__viewport?.viewport.setSection({ origin: [0, 0, 5], normal: [0, 0, 1], caps: true });
    });
    await frame(page);
    const top = (await at([20, 15, 20])) as { x: number; y: number };
    await page.evaluate(() => window.__viewport?.featureSolid(null));
    await frame(page);
    const [noSolid] = await samplePoints(page, [[top.x, top.y]]);
    await page.evaluate(() => window.__viewport?.featureSolid('cut'));
    await frame(page);
    const [clipped] = await samplePoints(page, [[top.x, top.y]]);
    expect(dist(clipped ?? [0, 0, 0], noSolid ?? [9, 9, 9])).toBeLessThan(3);
    await page.evaluate(() => window.__viewport?.viewport.setSection(null));

    await page.evaluate(() => window.__viewport?.featureSolid(null));
    expect(await stats()).toBeNull();
    await frame(page);
    const [cleared] = await samplePoints(page, [[over.x, over.y]]);
    expect(dist(cleared ?? [0, 0, 0], plain ?? [0, 0, 0])).toBeLessThan(3);
  });
});
