import { expect, test } from '@playwright/test';
import { boot } from './helpers';

/**
 * Owner, 2026-11-23: "every time I open the app it has to re-pair the 3D mouse". Chrome keeps a
 * WebHID permission across restarts only for a device with a serial number; many 3D mice have
 * none, so after a restart `getDevices()` is empty although the mouse was paired and is plugged
 * in. The app offers the way back in one click, in the view.
 */

/** A browser that granted a 3D mouse in an earlier session and has since forgotten it. */
const FORGOTTEN = () => {
  localStorage.setItem('wren.motion.paired', '1');
  const dev = {
    vendorId: 0x256f,
    productId: 0xc635,
    productName: 'Test 6-DoF controller',
    opened: false,
    collections: [{ usagePage: 1, usage: 8 }],
    open: () => {
      dev.opened = true;
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const w = window as unknown as { __hid: { asked: number; dev: typeof dev } };
  w.__hid = { asked: 0, dev };
  Object.defineProperty(navigator, 'hid', {
    configurable: true,
    value: {
      getDevices: () => Promise.resolve([]),
      requestDevice: () => {
        w.__hid.asked++;
        return Promise.resolve([dev]);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
};

test('a forgotten 3D mouse: one click on the chip pairs it again; dismissing is remembered', async ({
  page,
}) => {
  await page.addInitScript(FORGOTTEN);
  await boot(page);
  await page.getByRole('button', { name: 'Close welcome' }).click();

  // The device layer loads after the first paint and finds nothing granted.
  const chip = page.getByTestId('motion-reconnect');
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(chip).toContainText('3D mouse not connected');

  await page.getByTestId('motion-reconnect-pair').click();
  await page.waitForFunction(
    () => (window as unknown as { __hid: { dev: { opened: boolean } } }).__hid.dev.opened,
  );
  expect(
    await page.evaluate(() => (window as unknown as { __hid: { asked: number } }).__hid.asked),
  ).toBe(1);
  await expect(chip).toHaveCount(0);

  // Next start, still forgotten: the chip is back; dismiss it, and it stays away after a reload.
  await page.reload();
  await boot(page);
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('motion-reconnect-dismiss').click();
  await expect(chip).toHaveCount(0);
  await page.reload();
  await boot(page);
  await page.waitForTimeout(4000);
  await expect(chip).toHaveCount(0);
});
