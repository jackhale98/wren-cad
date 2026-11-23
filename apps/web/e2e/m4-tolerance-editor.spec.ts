import { expect, type Page, test } from '@playwright/test';
import type { Annotation, WrenDoc } from '@wren-cad/contracts';
import { app } from './helpers';
import {
  built,
  drawing,
  newDrawing,
  openDemo,
  panelTab,
  sheetToPage,
  viewOf,
} from './support/drawing-ui';

/**
 * The structured tolerance editor and inspection dimensions, in the real drawing route: choose the
 * type, fill its fields, see the dimension text and the round-ended frame on the sheet, reload.
 */

test.use({ viewport: { width: 1440, height: 900 } });
test.slow();

type Dim = Annotation & {
  tolerance?: { kind: string; [k: string]: unknown };
  inspection?: boolean;
};
const annotations = async (page: Page): Promise<Dim[]> =>
  (((await app(page).doc()).parts[0] as WrenDoc['parts'][number]).annotations ?? []) as Dim[];
const first = async (page: Page) => (await annotations(page))[0] as Dim;

async function dimension(page: Page): Promise<void> {
  await openDemo(page);
  await newDrawing(page);
  await panelTab(page, 'Views').click();
  await page.getByTestId('add-standard-views').click();
  await expect.poll(async () => (await drawing(page).state()).views.length).toBe(3);
  const s = await built(page);
  const top = viewOf(s, 'projected', 'top');
  if (!top) throw new Error('no top view');
  const edges = (await drawing(page).edges(top.id))
    .filter(
      (e) =>
        e.kind === 'line' &&
        e.a &&
        e.b &&
        Math.abs(e.a[0] - e.b[0]) < 0.01 &&
        Math.abs(e.a[1] - e.b[1]) > 30,
    )
    .sort((p, q) => p.at[0] - q.at[0]);
  const left = edges[0];
  const right = edges.at(-1);
  if (!left || !right) throw new Error('no edges');
  await page.locator('[data-tool="dimension"]').click();
  for (const e of [left, right]) {
    const at = await sheetToPage(page, e.at);
    await page.mouse.click(at.x, at.y);
  }
  await expect.poll(async () => (await annotations(page)).length).toBe(1);
  await built(page);
}

/** The arcs of the round-ended frame on the sheet (the viewer's SVG). */
const frameArcs = (page: Page) => page.locator('[data-testid="sheet-viewer"] svg path[d*="A"]');

test('choose Deviation, Fit and Inspection in the editor; the sheet follows; it survives a reload', async ({
  page,
}) => {
  await dimension(page);
  const editor = page.getByTestId('tolerance-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Seven types are on screen at once, none chosen yet.
  await expect(editor.getByRole('radio')).toHaveCount(7);
  await expect(editor.getByRole('radio', { name: 'None' })).toBeChecked();

  // Deviation: +0.2 / −0.1, each one undo step.
  await editor.getByRole('radio', { name: 'Deviation' }).click();
  await expect.poll(async () => (await first(page)).tolerance?.kind).toBe('bilateral');
  await editor.getByRole('textbox', { name: 'Upper deviation' }).fill('+0.2');
  await editor.getByRole('textbox', { name: 'Upper deviation' }).press('Enter');
  await editor.getByRole('textbox', { name: 'Lower deviation' }).fill('-0.1');
  await editor.getByRole('textbox', { name: 'Lower deviation' }).press('Enter');
  await expect
    .poll(async () => (await first(page)).tolerance)
    .toMatchObject({ kind: 'bilateral', upper: '0.2 mm', lower: '-0.1 mm' });
  await expect
    .poll(async () => (await built(page)).texts.join(' '))
    .toMatch(/\+0\.2[\s\S]*[-−]0\.1/);
  await expect(page.getByTestId('tolerance-preview-svg')).toHaveAttribute(
    'data-text',
    /80 \+0\.2\/[-−]0\.1/,
  );

  // The refused order is explained and nothing is stored.
  await editor.getByRole('textbox', { name: 'Lower deviation' }).fill('0.5');
  await editor.getByRole('textbox', { name: 'Lower deviation' }).press('Enter');
  await expect(editor.getByRole('alert')).toContainText('upper deviation is below');
  expect(((await first(page)).tolerance as { lower: string }).lower).toBe('-0.1 mm');

  // Fit: H7 is offered at 80 mm and its deviations are shown live.
  await editor.getByRole('radio', { name: 'Fit' }).click();
  await expect
    .poll(async () => (await first(page)).tolerance)
    .toMatchObject({ kind: 'fit', hole: 'H7', show: 'symbol' });
  await expect(editor.getByTestId('fit-deviations')).toContainText('H7: +0.03');
  await expect.poll(async () => (await built(page)).texts.join(' ')).toContain('H7');

  // Inspection: the frame appears on the sheet, and goes with the switch.
  const arcsBefore = await frameArcs(page).count();
  await editor.getByRole('switch', { name: 'Inspection dimension' }).click();
  await expect.poll(async () => (await first(page)).inspection).toBe(true);
  await built(page);
  await expect.poll(() => frameArcs(page).count()).toBe(arcsBefore + 2);

  // A reference dimension is not an inspection dimension: choosing it drops the flag in one edit.
  await editor.getByRole('radio', { name: 'Reference' }).click();
  await expect.poll(async () => (await first(page)).tolerance?.kind).toBe('reference');
  expect((await first(page)).inspection).toBeUndefined();
  await expect(editor.getByRole('switch', { name: 'Inspection dimension' })).toBeDisabled();

  // Back to a fit with inspection, then reload.
  await editor.getByRole('radio', { name: 'Fit' }).click();
  await expect.poll(async () => (await first(page)).tolerance?.kind).toBe('fit');
  await editor.getByRole('switch', { name: 'Inspection dimension' }).click();
  await expect.poll(async () => (await first(page)).inspection).toBe(true);
  const before = await first(page);
  await app(page).flushSave();
  await page.reload();
  await page.evaluate(() =>
    (
      window as unknown as { __wren: { firstBodyRendered(): Promise<unknown> } }
    ).__wren.firstBodyRendered(),
  );
  await app(page).idle();
  const after = await first(page);
  expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
  expect(after.inspection).toBe(true);
  expect(after.tolerance?.kind).toBe('fit');
});

test('undo steps back one edit at a time', async ({ page }) => {
  await dimension(page);
  const editor = page.getByTestId('tolerance-editor');
  await editor.getByRole('radio', { name: 'Symmetric' }).click();
  await expect.poll(async () => (await first(page)).tolerance?.kind).toBe('symmetric');
  await editor.getByRole('switch', { name: 'Inspection dimension' }).click();
  await expect.poll(async () => (await first(page)).inspection).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await first(page)).inspection).toBeUndefined();
  expect((await first(page)).tolerance?.kind).toBe('symmetric');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await first(page)).tolerance).toBeUndefined();
});
