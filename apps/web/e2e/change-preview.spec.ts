import { expect, type Page, test } from '@playwright/test';
import { app, boot } from './helpers';

/**
 * Change preview, slice 2e.1 (ADR-103): while a feature is edited the faces it made are tinted by
 * effect, a blind extrude shows its swept volume before the kernel answers, and a held key shows
 * the model as it was before the feature. Asserted through the test hooks (what the app asked for
 * and what the viewport engine holds), on the demo bracket.
 */
test.use({ viewport: { width: 1280, height: 720 } });

async function openDemo(page: Page) {
  await boot(page);
  const a = app(page);
  await page.getByTestId('open-demo').click();
  await expect.poll(async () => (await a.doc()).parts[0]?.features.length).toBeGreaterThan(0);
  await a.idle();
  const features = (await a.doc()).parts[0]?.features ?? [];
  const byName = (n: string) => {
    const f = features.find((x) => x.name === n);
    if (!f) throw new Error(`no feature ${n}`);
    return f;
  };
  return { a, features, byName };
}

test('editing a fillet tints the faces it made as modify, and editing ending clears it', async ({
  page,
}) => {
  test.slow();
  const { a, byName } = await openDemo(page);
  const fillet = byName('Bend fillet');
  expect((await a.changePreview()).tint).toBeNull();

  await a.editFeature(fillet.id);
  await expect.poll(async () => (await a.changePreview()).tint).not.toBeNull();
  const tint = (await a.changePreview()).tint;
  expect(tint).toMatchObject({ featureId: fillet.id, effect: 'modify' });
  expect(tint?.faces).toBeGreaterThan(0);
  // The viewport engine holds the same tint.
  expect(await a.changePreviewDrawn()).toMatchObject({ effect: 'modify', faces: tint?.faces });

  // A new radius regenerates; the tint is on the new faces in the frame the result arrives.
  const radius = page.getByTestId('feature-inspector').locator('[data-pointer="/radius"] input');
  await radius.fill('5 mm');
  await radius.press('Enter');
  await a.idle();
  await expect.poll(async () => (await a.changePreview()).tint?.effect).toBe('modify');
  expect(await a.changePreviewDrawn()).toMatchObject({ effect: 'modify' });

  // A radius the kernel cannot make: the feature errors and nothing is tinted.
  await radius.fill('900 mm');
  await radius.press('Enter');
  await a.idle();
  await expect
    .poll(async () => (await a.regen())?.features.find((f) => f.id === fillet.id)?.state)
    .not.toBe('ok');
  expect((await a.changePreview()).tint).toBeNull();
  expect(await a.changePreviewDrawn()).toMatchObject({ effect: null, faces: 0 });
  await radius.fill('3 mm');
  await radius.press('Enter');
  await a.idle();
  await expect.poll(async () => (await a.changePreview()).tint).not.toBeNull();

  // Editing ends: nothing stays tinted.
  await page.getByTestId('feature-inspector').getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await a.ui()).featureId).toBeNull();
  expect((await a.changePreview()).tint).toBeNull();
  expect(await a.changePreviewDrawn()).toMatchObject({ effect: null, faces: 0 });
});

test('editing an extrude tints add; its depth shows the swept volume before the regen', async ({
  page,
}) => {
  test.slow();
  const { a, byName } = await openDemo(page);
  const upright = byName('Upright');
  await a.editFeature(upright.id);
  await expect.poll(async () => (await a.changePreview()).tint?.effect).toBe('add');
  expect((await a.changePreview()).prism).toBeNull();

  const depth = page.getByTestId('extrude-depth-input').getByRole('textbox');
  await expect(depth).toBeVisible();
  // Typing a value: in the same task as the input the prism is up (the kernel cannot have answered).
  const sync = await page.evaluate(() => {
    const w = window as unknown as {
      __wrenApp: {
        changePreview(): { prism: { distance: number; effect: string } | null };
        changePreviewDrawn(): { prism: { distance: number; effect: string } | null } | null;
      };
    };
    const input = document.querySelector(
      '[data-testid="extrude-depth-input"] input',
    ) as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, '25 mm');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      app: w.__wrenApp.changePreview().prism,
      drawn: w.__wrenApp.changePreviewDrawn()?.prism,
    };
  });
  expect(sync.app).toMatchObject({ distance: 25, effect: 'add' });
  expect(sync.drawn).toMatchObject({ distance: 25, effect: 'add' });

  // The regen of that document replaces the estimate with the real, tinted faces.
  await depth.press('Enter');
  await a.idle();
  await expect.poll(async () => (await a.changePreview()).prism).toBeNull();
  expect((await a.changePreviewDrawn())?.prism).toBeNull();
  expect((await a.changePreview()).tint).toMatchObject({ effect: 'add' });
  const f = (await a.doc()).parts[0]?.features.find((x) => x.id === upright.id);
  expect(f?.type === 'extrude' && f.end.kind === 'blind' && f.end.depth).toBe('25 mm');
});

test('editing a cut tints cut; a through-all end has no same-frame prism', async ({ page }) => {
  test.slow();
  const { a, byName } = await openDemo(page);
  const holes = byName('Holes');
  await a.editFeature(holes.id);
  await expect.poll(async () => (await a.changePreview()).tint?.effect).toBe('cut');
  expect((await a.changePreview()).prism).toBeNull();
});

/**
 * Slice 2e.2: the exact solid the edited feature adds or removes comes with the regen result
 * (`RegenResult.preview`) and is drawn translucent. Demo bracket: thickness 8, four 6 mm holes.
 */
const HOLES = 4 * Math.PI * 3 ** 2;

test('editing the Holes cut shows the removed material; values update it; Done clears it', async ({
  page,
}) => {
  test.slow();
  const { a, byName } = await openDemo(page);
  const holes = byName('Holes');
  expect((await a.changePreview()).solid).toBeNull();
  expect((await a.changePreviewDrawn())?.solid).toBeNull();

  await a.editFeature(holes.id);
  await expect.poll(async () => (await a.changePreview()).solid).not.toBeNull();
  const solid = (await a.changePreview()).solid;
  // Through all: what is shown is the material removed, not the over-long tool.
  expect(solid).toMatchObject({ featureId: holes.id, effect: 'cut', shows: 'removed', meshes: 1 });
  expect(solid?.volume).toBeCloseTo(HOLES * 8, 3);
  // The viewport holds it, in the section-clipped root, and nothing was rebuilt needlessly.
  await a.idle();
  const drawn = (await a.changePreviewDrawn())?.solid;
  expect(drawn).toMatchObject({ effect: 'cut', meshes: 1, clipped: true });
  expect(drawn?.triangles).toBeGreaterThan(0);
  // The request changed nothing else: the part is the demo bracket's.
  expect((await a.regen())?.features.every((f) => f.state === 'ok')).toBe(true);

  // Blind: the inspector's default depth (10 mm) still goes through the 8 mm plate.
  const inspector = page.getByTestId('feature-inspector');
  await inspector.getByRole('radio', { name: 'Blind' }).click();
  await a.idle();
  await expect.poll(async () => (await a.changePreview()).solid?.volume).toBeCloseTo(HOLES * 8, 3);
  // A new depth: the exact solid of that value replaces the one of the old value.
  const depth = inspector.locator('[data-pointer="/end/depth"] input');
  await depth.fill('3 mm');
  await depth.press('Enter');
  await a.idle();
  await expect.poll(async () => (await a.changePreview()).solid?.volume).toBeCloseTo(HOLES * 3, 3);
  expect((await a.changePreview()).prism).toBeNull(); // the same-frame estimate is gone
  expect((await a.changePreviewDrawn())?.solid).toMatchObject({ effect: 'cut', meshes: 1 });

  // A depth the kernel refuses: the feature errors, and no solid of the old value stays.
  await depth.fill('0 mm');
  await depth.press('Enter');
  await a.idle();
  await expect
    .poll(async () => (await a.regen())?.features.find((f) => f.id === holes.id)?.state)
    .not.toBe('ok');
  expect((await a.changePreview()).solid).toBeNull();
  expect((await a.changePreviewDrawn())?.solid).toBeNull();
  await depth.fill('5 mm');
  await depth.press('Enter');
  await a.idle();
  await expect.poll(async () => (await a.changePreview()).solid?.volume).toBeCloseTo(HOLES * 5, 3);

  // Before (H held): the model without the cut, and no solid; released, the same solid is back.
  await depth.blur(); // the key is a shortcut, not text for the depth field
  await page.keyboard.down('h');
  await expect.poll(async () => (await a.changePreview()).before).toBe(true);
  await a.idle();
  expect((await a.changePreview()).solid).toBeNull();
  expect((await a.changePreviewDrawn())?.solid).toBeNull();
  await page.keyboard.up('h');
  await expect.poll(async () => (await a.changePreview()).before).toBe(false);
  await a.idle();
  await expect.poll(async () => (await a.changePreview()).solid?.volume).toBeCloseTo(HOLES * 5, 3);

  // Editing ends: nothing of the preview stays, in the app or in the viewport.
  await inspector.getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await a.ui()).featureId).toBeNull();
  expect((await a.changePreview()).solid).toBeNull();
  expect((await a.changePreviewDrawn())?.solid).toBeNull();
});

test('editing an extrude add shows its tool solid; a fillet has no solid', async ({ page }) => {
  test.slow();
  const { a, byName } = await openDemo(page);
  const upright = byName('Upright');
  await a.editFeature(upright.id);
  await expect.poll(async () => (await a.changePreview()).solid).not.toBeNull();
  // Upright: width 80 x thickness 8, height 50 (the demo's parameters).
  const solid = (await a.changePreview()).solid;
  expect(solid).toMatchObject({ featureId: upright.id, effect: 'add', shows: 'tool', meshes: 1 });
  expect(solid?.volume).toBeGreaterThan(0);
  expect((await a.changePreviewDrawn())?.solid).toMatchObject({ effect: 'add', clipped: true });

  // Another feature is opened: the solid of the first is not shown for it.
  const fillet = byName('Bend fillet');
  await a.editFeature(fillet.id);
  await expect.poll(async () => (await a.changePreview()).tint?.effect).toBe('modify');
  await a.idle();
  expect((await a.changePreview()).solid).toBeNull();
  expect((await a.changePreviewDrawn())?.solid).toBeNull();
});

test('holding the Before key shows the model without the feature and changes no document', async ({
  page,
}) => {
  test.slow();
  const { a, features, byName } = await openDemo(page);
  const fillet = byName('Bend fillet');
  const index = features.findIndex((f) => f.id === fillet.id);
  await a.editFeature(fillet.id);
  await expect.poll(async () => (await a.changePreview()).tint).not.toBeNull();
  const docBefore = JSON.stringify(await a.doc());
  const history = await a.history();
  const volume = (await a.regen())?.bodies[0]?.volume;

  await page.keyboard.down('h');
  await expect.poll(async () => (await a.changePreview()).before).toBe(true);
  // The regen runs rolled back to just before the fillet; the tree and the document are untouched.
  await expect.poll(async () => (await a.regen())?.rollback).toBe(index);
  await a.idle();
  expect((await a.changePreview()).tint).toBeNull();
  expect(JSON.stringify(await a.doc())).toBe(docBefore);
  expect(await a.history()).toEqual(history);
  const shown = (await a.regen())?.bodies[0]?.volume;
  expect(shown).not.toBe(volume);

  await page.keyboard.up('h');
  await expect.poll(async () => (await a.changePreview()).before).toBe(false);
  await a.idle();
  await expect.poll(async () => (await a.regen())?.rollback).toBe(features.length);
  expect((await a.regen())?.bodies[0]?.volume).toBe(volume);
  await expect.poll(async () => (await a.changePreview()).tint).not.toBeNull();
  expect(JSON.stringify(await a.doc())).toBe(docBefore);
  expect(await a.history()).toEqual(history);
});

test('the Before key does nothing while no feature is open', async ({ page }) => {
  test.slow();
  const { a } = await openDemo(page);
  await page.keyboard.down('h');
  await page.keyboard.up('h');
  expect((await a.changePreview()).before).toBe(false);
});
