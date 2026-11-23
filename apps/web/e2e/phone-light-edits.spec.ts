import { devices, expect, type Page, test } from '@playwright/test';
import { app, boot, touch } from './helpers';

/**
 * Phase 2c (ADR-101): the phone's review layout turns on `editValues`. Change a feature's number
 * inline (the kernel boots on the edit), change a parameter, save a version; the menu still has no
 * Delete / Edit / Rename. Switching configuration is covered in m37-phone.spec.ts (the chip).
 */

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: devices['iPhone 13'].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

test.describe.configure({ timeout: 240_000 });

const tab = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Viewer tools' }).getByRole('button', { name });

async function openDemo(page: Page) {
  await boot(page);
  const a = app(page);
  await page.getByTestId('open-demo').tap();
  await expect.poll(async () => (await a.doc()).parts[0]?.features.length).toBeGreaterThan(0);
  await a.idle();
  return a;
}

/** Long-press a feature row and choose "Values" (the menu has no Delete, Edit or Rename). */
async function openValues(page: Page, row: RegExp) {
  await tab(page, 'Features').tap();
  const el = page.getByRole('treeitem', { name: row });
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error('row not laid out');
  const t = await touch(page);
  await t.down([{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]);
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await t.up();
  const names = await menu.getByRole('menuitem').allTextContents();
  expect(names.some((n) => /^Values/.test(n))).toBe(true);
  for (const gone of [/Delete/, /Edit/, /Rename/, /folder/i])
    expect(names.filter((n) => gone.test(n))).toEqual([]);
  await menu.getByRole('menuitem', { name: /^Values/ }).tap();
}

test('phone: change an extrude depth inline; the document and the feature update, one undo step', async ({
  page,
}) => {
  test.slow();
  const a = await openDemo(page);
  const before = await a.regen();
  const past0 = (await a.history()).past.length;

  await openValues(page, /^Plate(?! sketch)/);
  const pane = page.getByTestId('feature-values');
  await expect(pane).toBeVisible();
  // Values only: Depth is there; no reference pickers, no delete.
  const depth = pane.getByRole('textbox', { name: 'Depth' });
  await expect(depth).toBeVisible();
  await expect(pane.getByRole('button', { name: /Delete|Rename|Edit/ })).toHaveCount(0);

  await depth.tap();
  const keypad = page.getByTestId('keypad');
  await expect(keypad).toBeVisible();
  await keypad.getByRole('button', { name: 'AC (clear)' }).tap();
  await keypad.getByRole('button', { name: '1', exact: true }).tap();
  await keypad.getByRole('button', { name: '2', exact: true }).tap();
  await keypad.getByRole('button', { name: 'mm (millimetres)' }).tap();
  await keypad.getByRole('button', { name: 'Enter' }).tap();
  await a.idle();

  const plate = (await a.doc()).parts[0]?.features.find((f) => f.name === 'Plate');
  expect(plate && 'end' in plate ? plate.end : null).toMatchObject({ kind: 'blind' });
  expect(JSON.stringify(plate)).toMatch(/12\s?mm/);
  expect((await a.history()).past.length).toBe(past0 + 1);
  const after = await a.regen();
  expect(after?.bodies[0]?.volume).not.toBeCloseTo(before?.bodies[0]?.volume ?? 0, 0);
});

test('phone: Params tab edits an expression with the keypad', async ({ page }) => {
  test.slow();
  const a = await openDemo(page);
  await tab(page, 'Params').tap();
  const field = page.getByRole('textbox', { name: 'Expression for thickness' });
  await field.scrollIntoViewIfNeeded();
  await field.tap();
  const keypad = page.getByTestId('keypad');
  await keypad.getByRole('button', { name: 'AC (clear)' }).tap();
  await keypad.getByRole('button', { name: '9', exact: true }).tap();
  await keypad.getByRole('button', { name: 'mm (millimetres)' }).tap();
  await keypad.getByRole('button', { name: 'Enter' }).tap();
  await a.idle();
  const p = (await a.doc()).params.find((x) => x.name === 'thickness');
  expect(p?.expr).toMatch(/^9\s?mm$/);
});

test('phone: save a version from the versions panel', async ({ page }) => {
  test.slow();
  const a = await openDemo(page);
  const sync = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __wrenApp: { sync(): Promise<{ versions: { auto: boolean }[] }> };
        }
      ).__wrenApp.sync(),
    );
  const before = (await sync()).versions.filter((v) => !v.auto).length;
  await page.getByTestId('versions-button').tap();
  const panel = page.getByTestId('project-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('radio', { name: 'Versions' }).tap();
  await panel.getByLabel('Save version').fill('Phone tweak');
  await panel.getByRole('button', { name: /Save version/ }).tap();
  await expect
    .poll(async () => (await sync()).versions.filter((v) => !v.auto).length)
    .toBe(before + 1);
  await a.idle();
});
