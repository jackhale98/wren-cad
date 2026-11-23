import { expect, type Page, test } from '@playwright/test';
import type { Id, SketchConstraint, SketchFeature } from '@wren-cad/contracts';
import { app, boot, clickAt, sketchOn, toPage } from './helpers';

/**
 * Owner, 2026-11-23 (ADR-087 amendment): inferred constraints between separate shapes are kept,
 * but it must be obvious they were added and easy to remove. The lead's scene: a rectangle, then
 * a closed line-tool shape beside it, drawn by hand so some clicks land level with the
 * rectangle's corners. Each such click says so in a toast with Remove; every link shows its glyph
 * at both shapes; a drag that moves the rectangle through a link highlights that link; removing
 * the links (toast or glyph) makes the shapes independent again.
 */

async function sketchOf(page: Page): Promise<SketchFeature> {
  await app(page).settled();
  const f = (await app(page).doc()).parts[0]?.features.find((x) => x.type === 'sketch');
  if (f?.type !== 'sketch') throw new Error('no sketch');
  return f;
}

const refs = (c: SketchConstraint): Id[] =>
  Object.entries(c).flatMap(([k, v]) =>
    k === 'id' || k === 'kind' || typeof v !== 'string' ? [] : [v],
  );

/** Constraints naming an entity of each set. */
const linking = (f: SketchFeature, a: Set<Id>, b: Set<Id>) =>
  f.constraints.filter((c) => refs(c).some((r) => a.has(r)) && refs(c).some((r) => b.has(r)));

const points = (f: SketchFeature, ids: Set<Id>) =>
  f.entities.flatMap((e) => (e.kind === 'point' && ids.has(e.id) ? [[e.id, e.x, e.y]] : []));

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await toPage(page, [from[0], from[1], 0]);
  const b = await toPage(page, [to[0], to[1], 0]);
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12);
  return {
    release: async () => {
      await page.mouse.up();
      await app(page).settled();
    },
  };
}

test('links to another shape are announced with Remove, shown at both shapes, highlighted while they carry a drag, and removable', async ({
  page,
}) => {
  test.slow();
  await boot(page);
  await page.keyboard.press('s');
  await sketchOn(page, 'Top');
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await clickAt(page, -60, -30);
  await clickAt(page, -20, 10);
  const rect = new Set((await sketchOf(page)).entities.map((e) => e.id));
  expect(rect.size).toBe(8);

  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const toast = page.getByTestId('toast');
  const said: string[] = [];
  for (const [x, y] of [
    [20, -29.4],
    [50, -29.6],
    [50.3, 10.4],
  ] as const) {
    await clickAt(page, x, y);
    await app(page).settled();
    if (await toast.isVisible()) said.push((await toast.textContent()) ?? '');
  }
  // The third click landed level with the rectangle's top-right corner: said in plain words,
  // with Remove. Remove takes just that constraint away (one undo step).
  await expect(toast).toContainText('Kept level with another shape');
  const shapeSoFar = () =>
    sketchOf(page).then((f) => new Set(f.entities.map((e) => e.id).filter((id) => !rect.has(id))));
  const before = linking(await sketchOf(page), rect, await shapeSoFar()).length;
  expect(before).toBeGreaterThan(0);
  await page.getByTestId('toast-action').click();
  await expect
    .poll(async () => linking(await sketchOf(page), rect, await shapeSoFar()).length)
    .toBe(before - 1);

  for (const [x, y] of [
    [20.2, 9.7],
    [20, -29.4],
  ] as const)
    await clickAt(page, x, y);
  await page.keyboard.press('Escape');
  const f = await sketchOf(page);
  const shape = new Set(f.entities.map((e) => e.id).filter((id) => !rect.has(id)));
  const links = linking(f, rect, shape);
  // The first click (level with the rectangle's bottom) is still linked, and was announced too.
  expect(links.length).toBeGreaterThan(0);
  expect(said.some((t) => /another shape/.test(t))).toBe(true);
  // Each link's glyph sits at both shapes.
  await expect(page.locator('[data-testid="constraint-glyph"][data-link]')).toHaveCount(
    2 * links.length,
  );

  // Dragging the shape's bottom edge down drags the rectangle's bottom through the link: the
  // link glyphs that carry it are highlighted during the drag, and not after.
  const rectBefore = points(f, rect);
  const d = await drag(page, [35, -29.5], [35, -45]);
  await expect(
    page.locator('[data-testid="constraint-glyph"][data-carrying]').first(),
  ).toBeVisible();
  await d.release();
  expect(points(await sketchOf(page), rect)).not.toEqual(rectBefore);
  await expect(page.locator('[data-testid="constraint-glyph"][data-carrying]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => points(await sketchOf(page), rect)).toEqual(rectBefore);

  // Remove every link from its glyph: select it, then its "Remove constraint" chip.
  for (let n = links.length; n > 0; n--) {
    await page.locator('[data-testid="constraint-glyph"][data-link]').first().click();
    await page.getByTestId('remove-constraint').click();
    await expect.poll(async () => linking(await sketchOf(page), rect, shape).length).toBe(n - 1);
  }
  // Independent again: the same drag leaves every point of the rectangle where it was.
  const d2 = await drag(page, [35, -29.5], [35, -45]);
  await d2.release();
  const after = await sketchOf(page);
  expect(points(after, rect)).toEqual(rectBefore);
  expect(points(after, shape)).not.toEqual(points(f, shape));
});
