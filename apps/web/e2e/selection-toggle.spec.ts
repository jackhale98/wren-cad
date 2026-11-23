import { expect, test } from '@playwright/test';
import { addBox, app, boot, topCenter } from './helpers';

/**
 * Owner, 2026-11-23: clicking a face, edge or vertex that is already selected deselects it. The
 * rest of the selection stays; no modifier is needed.
 */
test('clicking a selected face deselects it; clicking it again selects it', async ({ page }) => {
  test.slow();
  await boot(page);
  await addBox(page);
  const a = app(page);
  await a.idle();
  const c = await topCenter(page);

  await page.mouse.click(c.x, c.y);
  await a.idle();
  expect((await a.ui()).selection).toEqual(['face']);

  // A pause longer than a double click, so the second press is its own click.
  await page.waitForTimeout(450);
  await page.mouse.click(c.x, c.y);
  await a.idle();
  expect((await a.ui()).selection).toEqual([]);

  await page.waitForTimeout(450);
  await page.mouse.click(c.x, c.y);
  await a.idle();
  expect((await a.ui()).selection).toEqual(['face']);

  // A double click is one gesture (zoom to it): it ends selected, whether it started selected…
  await page.waitForTimeout(450);
  await page.mouse.dblclick(c.x, c.y);
  await a.idle();
  expect((await a.ui()).selection).toEqual(['face']);
  // …or not.
  await page.waitForTimeout(450);
  const c2 = await topCenter(page);
  await page.mouse.click(c2.x, c2.y);
  await a.idle();
  expect((await a.ui()).selection).toEqual([]);
  await page.waitForTimeout(450);
  await page.mouse.dblclick(c2.x, c2.y);
  await a.idle();
  expect((await a.ui()).selection).toEqual(['face']);
});
