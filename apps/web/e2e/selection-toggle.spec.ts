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
});
