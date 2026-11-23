import { devices, expect, test } from '@playwright/test';
import { app, boot, palette } from './helpers';

/**
 * ADR-101 amendment, phone: "Use full editor" swaps the review shell for the desktop structure at
 * touch density (capabilities, not device names), editing works, and switching it off returns to the
 * review shell with the document intact. The chrome remounts; the document does not reload.
 */

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: devices['iPhone 13'].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

test('phone: Use full editor gives the editing shell at touch density, and off restores review', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await boot(page);
  const a = app(page);
  await page.getByTestId('open-demo').tap();
  await expect.poll(async () => (await a.doc()).parts[0]?.features.length).toBeGreaterThan(0);
  await a.idle();
  const before = await a.doc();
  const n = before.parts[0]?.features.length ?? 0;

  const viewerTools = page.getByRole('group', { name: 'Viewer tools' });
  const modelingTools = page.getByLabel('Modeling tools');
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-tier', 'phone');
  await expect(viewerTools).toBeVisible();
  await expect(modelingTools).toHaveCount(0);
  // Review: no Settings button in the bar, and the setting is in Settings (reached by the palette).
  await expect(page.getByTestId('settings-button')).toHaveCount(0);

  // Turn it on from the Settings panel (the command palette offers it too).
  await palette(page, 'Settings');
  const sw = page.getByRole('switch', { name: 'Use full editor' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.tap();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('settings-close').tap();

  // The desktop structure at touch density: the settings button, the modeling tools, 44 px targets.
  await expect(viewerTools).toHaveCount(0);
  await expect(page.getByTestId('settings-button')).toBeVisible();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-tier', 'phone');
  const sketchBtn = page.getByRole('button', { name: 'Sketch', exact: true });
  await expect(sketchBtn).toBeVisible();
  expect((await sketchBtn.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  // The choice is stored per device.
  expect(await page.evaluate(() => localStorage.getItem('wren.fullEditor'))).toBe('1');

  // Editing works: start a sketch (the kernel boots on the first edit).
  await sketchBtn.tap();
  await page.getByTestId('plane-chooser').getByRole('button', { name: /Top/ }).tap();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
  await expect.poll(async () => (await a.ui()).sketch !== null).toBe(true);
  await page.getByRole('button', { name: 'Done' }).tap();
  await a.idle();

  // Off again, from the palette: back to the review shell, same document (nothing reloaded).
  await palette(page, 'Use the review layout');
  await expect(viewerTools).toBeVisible();
  await expect(page.getByTestId('settings-button')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('wren.fullEditor'))).toBeNull();
  const after = await a.doc();
  expect(after.meta.id).toBe(before.meta.id);
  expect(after.parts[0]?.features.length).toBeGreaterThanOrEqual(n);
});
