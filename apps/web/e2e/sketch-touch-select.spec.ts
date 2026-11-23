import { devices, expect, type Page, test } from '@playwright/test';
import type { SketchFeature } from '@wren-cad/contracts';
import { app, boot, cameraStill, toPage, touch } from './helpers';

/**
 * Owner, iPad, 2026-11-23: "there was no way to select more than one vertex or line to add
 * constraints in the sketcher." With the Select tool a tap adds to the selection, a tap on a
 * selected entity removes it, a tap on empty space clears it; the constraint menu then offers
 * what the multi-selection takes. A press-and-move still drags without changing the selection.
 * A constraint glyph is removable by touch too (its Remove chip).
 */

test.use({
  viewport: { width: 1180, height: 820 },
  userAgent: devices['iPad Pro 11'].userAgent,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});

async function sketchOf(page: Page): Promise<SketchFeature> {
  await app(page).settled();
  const f = (await app(page).doc()).parts[0]?.features.find((x) => x.type === 'sketch');
  if (f?.type !== 'sketch') throw new Error('no sketch');
  return f;
}

const selected = async (page: Page) => {
  await app(page).settled();
  return (await app(page).ui()).sketch?.selected ?? [];
};

test('taps build a multi-selection, the constraint menu applies to it, a tap deselects, empty clears', async ({
  page,
}) => {
  test.slow();
  await boot(page);
  await page.getByRole('button', { name: 'Close welcome' }).tap();
  const t = await touch(page);
  await page.getByRole('button', { name: 'Sketch', exact: true }).tap();
  await page.getByTestId('plane-chooser').getByRole('button', { name: /Top/ }).tap();
  const tools = page.getByRole('toolbar', { name: 'Sketch tools' });
  await expect(tools).toBeVisible();
  await cameraStill(page);

  // Two free points, far from each other and from the axes (no snaps).
  await tools.getByRole('button', { name: 'Point', exact: true }).tap();
  const at = { a: [-30, 15] as const, b: [25, 32] as const };
  await t.tap([await toPage(page, [at.a[0], at.a[1], 0])]);
  await t.tap([await toPage(page, [at.b[0], at.b[1], 0])]);
  const f = await sketchOf(page);
  const ids = f.entities.filter((e) => e.kind === 'point').map((e) => e.id);
  expect(ids).toHaveLength(2);
  const [pa, pb] = ids as [string, string];
  await tools.getByRole('button', { name: 'Select', exact: true }).tap();
  const tool = async () => (await app(page).ui()).sketch?.tool ?? null;
  await expect.poll(tool).toBeNull();

  const pageA = await toPage(page, [at.a[0], at.a[1], 0]);
  const pageB = await toPage(page, [at.b[0], at.b[1], 0]);
  await t.tap([pageA]);
  await expect.poll(() => selected(page)).toEqual([pa]);
  await page.waitForTimeout(400); // not a double-tap
  await t.tap([pageB]);
  await expect.poll(() => selected(page)).toEqual([pa, pb]);

  // The constraint menu offers what two points take: Horizontal points applies to both.
  await tools.getByRole('button', { name: 'Constraints' }).tap();
  const item = page.getByRole('menuitem', { name: 'Horizontal points' });
  await expect(item).toBeEnabled();
  await item.tap();
  await expect
    .poll(async () => (await sketchOf(page)).constraints.map((c) => c.kind))
    .toContain('horizontalPoints');

  // A tap on a selected point removes it; a tap on empty space clears the rest.
  const solved = await sketchOf(page);
  const pos = (id: string) => {
    const e = solved.entities.find((x) => x.id === id);
    return e?.kind === 'point' ? ([e.x, e.y] as const) : ([0, 0] as const);
  };
  const [ax, ay] = pos(pa);
  const [bx, by] = pos(pb);
  const selA = await toPage(page, [ax, ay, 0]);
  const selB = await toPage(page, [bx, by, 0]);
  if ((await selected(page)).length === 0) {
    // Applying a constraint may clear the selection: rebuild it first.
    await t.tap([selA]);
    await page.waitForTimeout(400);
    await t.tap([selB]);
  }
  await expect.poll(() => selected(page)).toEqual([pa, pb]);
  await page.waitForTimeout(400);
  await t.tap([selA]);
  await expect.poll(() => selected(page)).toEqual([pb]);

  // A press-and-move on the other point drags it and leaves the selection as it was.
  await page.waitForTimeout(400);
  await t.drag(selA, { x: selA.x - 40, y: selA.y + 30 });
  await expect.poll(() => selected(page)).toEqual([pb]);
  const dragged = (await sketchOf(page)).entities.find((e) => e.id === pa);
  expect(dragged?.kind === 'point' && Math.abs(dragged.x - ax) > 1).toBe(true);

  await page.waitForTimeout(400);
  // Empty space above the shapes (the toolbar is at the bottom).
  const empty = await toPage(page, [60, 45, 0]);
  await t.tap([empty]);
  await expect.poll(() => selected(page)).toEqual([]);
  expect(await tool()).toBeNull();

  // The constraint's glyph is removable by touch: a tap selects it, its chip removes it.
  const glyph = page.locator('[data-testid="constraint-glyph"][data-kind="horizontalPoints"]');
  await expect(glyph.first()).toBeVisible();
  await glyph.first().tap();
  const remove = page.getByTestId('remove-constraint');
  const box = await remove.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await remove.tap();
  await expect
    .poll(async () => (await sketchOf(page)).constraints.map((c) => c.kind))
    .not.toContain('horizontalPoints');
});
