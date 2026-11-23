import { expect, test } from '@playwright/test';
import { app, boot, cameraStill, topCenter } from './helpers';

/**
 * Owner, 2026-11-23: a right click on a surface offers, in the radial menu, editing the feature
 * that made it and the sketch that feature was made from.
 */
test.use({ viewport: { width: 1280, height: 720 } });

test('right click a face: Edit feature opens its inspector, Edit sketch opens its sketch', async ({
  page,
}) => {
  test.slow();
  await boot(page);
  const a = app(page);
  await page.getByTestId('open-demo').click();
  await expect.poll(async () => (await a.doc()).parts[0]?.features.length).toBeGreaterThan(0);
  await a.idle();
  await page.keyboard.press('0');
  await cameraStill(page);
  const features = (await a.doc()).parts[0]?.features ?? [];

  const menu = page.getByTestId('radial-menu');
  const open = async () => {
    const c = await topCenter(page);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await expect(menu).toBeVisible();
  };

  await open();
  expect((await a.ui()).selection).toEqual(['face']);
  const editFeature = menu.locator('[data-item="edit:feature"]');
  const editSketch = menu.locator('[data-item="edit:sketch"]');
  await expect(editFeature).toBeVisible();
  await expect(editSketch).toBeVisible();
  expect(await menu.locator('[data-item]').count()).toBeLessThanOrEqual(8);

  await editFeature.click();
  await expect(menu).toHaveCount(0);
  const edited = (await a.ui()).featureId;
  const f = features.find((x) => x.id === edited);
  expect(f, 'the inspector shows a feature of the part').toBeTruthy();
  expect(f?.type).not.toBe('sketch');
  await page.keyboard.press('Escape');

  await open();
  await editSketch.click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
  const sk = (await a.ui()).sketch;
  expect(sk).not.toBeNull();
});
