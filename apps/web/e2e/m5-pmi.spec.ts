import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import type { Annotation, WrenDoc } from '@wren-cad/contracts';
import { docWith, extrude, fid, region, Sk, side } from './fixtures';
import { app, boot } from './helpers';

/**
 * M5a (ADR-100): STEP AP242 with model dimensions and tolerances (PMI).
 *
 * Export: the STEP option "AP242 with model dimensions and tolerances (PMI)" is on by default for
 * a part with annotations; after the export a non-modal summary lists how many went across and
 * every one left out with its reason. Until the kernel façade writes PMI, the worker stands in for
 * it (`__wrenApp.pmiFacadeFake()`: the geometry as AP242), so the worker's planning,
 * presentation and report run for real (FACADE-PMI-PENDING).
 *
 * Import: a NIST MBE PMI model (public NIST data, packages/test-fixtures/step/nist) imports its
 * geometry and the report says what PMI it has that this kernel build cannot read yet.
 */

test.use({ viewport: { width: 1280, height: 720 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };
    w.showSaveFilePicker = undefined;
    w.showOpenFilePicker = undefined;
  });
});

const S1 = fid('PS1');
const E1 = fid('PE1');
const model = { kind: 'model' } as const;
const face = (name: string) => ({ name, kind: 'face' as const });

/** A plate 80 × 50 × 10 with five annotations: three export, two say why they do not. */
function plateDoc(): WrenDoc {
  const s = new Sk();
  s.rect('p', 'L', 0, 0, 80, 50, 'width', 'depth');
  const doc = docWith('PMI plate', { width: '80 mm', depth: '50 mm', t: '10 mm' }, [
    s.feature(S1, 'Plate sketch'),
    extrude(E1, 'Plate', [region(S1, 'L1,L2,L3,L4')], 't'),
  ]);
  const annotations: Annotation[] = [
    {
      id: fid('PMA1'),
      kind: 'linear',
      origin: model,
      refs: [face(`F${E1}:start`), face(`F${E1}:end`)],
      tolerance: { kind: 'symmetric', value: '0.1 mm' },
    },
    {
      id: fid('PMA2'),
      kind: 'linear',
      origin: model,
      refs: [face(side(E1, S1, 'L4')), face(side(E1, S1, 'L2'))],
    },
    {
      id: fid('PMA3'),
      kind: 'datumFeature',
      origin: model,
      label: 'A',
      refs: [face(`F${E1}:start`)],
    },
    // A face that is not in the model: needs attention, never exported.
    {
      id: fid('PMA4'),
      kind: 'linear',
      origin: model,
      refs: [face(`F${E1}:start`), face(side(E1, S1, 'L9'))],
    },
    { id: fid('PMA5'), kind: 'note', origin: model, text: 'Deburr', refs: [face(`F${E1}:end`)] },
  ];
  (doc.parts[0] as WrenDoc['parts'][number]).annotations = annotations;
  return doc;
}

async function pmiFacadeFake(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (
      window as unknown as { __wrenApp: { pmiFacadeFake(): Promise<boolean> } }
    ).__wrenApp.pmiFacadeFake(),
  );
}

test('STEP export with PMI: on by default, then a non-modal summary with every reason', async ({
  page,
}) => {
  await boot(page);
  await app(page).load(plateDoc());
  await app(page).idle();
  expect(await pmiFacadeFake(page)).toBe(true);

  await page.getByRole('button', { name: 'Export' }).click();
  const form = page.getByTestId('export-form');
  await form.getByRole('radio', { name: /STEP/ }).click();
  const pmi = form.getByRole('switch', {
    name: 'AP242 with model dimensions and tolerances (PMI)',
  });
  await expect(pmi).toHaveAttribute('aria-checked', 'true');
  await expect(form.getByRole('switch', { name: /presentation/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(form.getByTestId('export-pmi')).toContainText('5 annotations');

  const download = page.waitForEvent('download');
  await form.getByRole('button', { name: /^Export STEP/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.step$/);
  const text = readFileSync((await file.path()) as string, 'latin1');
  expect(text).toMatch(/FILE_SCHEMA\s*\(\s*\(\s*'AP242/);

  const report = page.getByTestId('pmi-report');
  await expect(report.getByTestId('pmi-report-title')).toHaveText(
    'Exported 3 annotations as PMI (AP242)',
    { timeout: 30_000 },
  );
  await expect(report.getByTestId('pmi-report-summary')).toContainText('2 not included');
  const entries = report.getByTestId('pmi-report-entries').getByRole('listitem');
  await expect(entries).toHaveCount(2);
  await expect(entries.filter({ hasText: 'Linear dimension' })).toContainText(/Needs attention/);
  await expect(entries.filter({ hasText: 'Note' })).toContainText(
    'Notes are not exported as PMI yet',
  );
  // Non-modal: nothing is a dialog, the viewport stays usable, focus stays where it was.
  expect(await page.locator('[aria-modal="true"]').count()).toBe(0);
  await expect(report).not.toBeFocused();
  await report.getByRole('button', { name: 'Dismiss' }).click();
  await expect(report).toHaveCount(0);
});

test('STEP export without PMI: the option off writes AP214 and shows no summary', async ({
  page,
}) => {
  await boot(page);
  await app(page).load(plateDoc());
  await app(page).idle();
  await page.getByRole('button', { name: 'Export' }).click();
  const form = page.getByTestId('export-form');
  await form.getByRole('radio', { name: /STEP/ }).click();
  await form.getByRole('switch', { name: /PMI/ }).click();
  const download = page.waitForEvent('download');
  await form.getByRole('button', { name: /^Export STEP/ }).click();
  const text = readFileSync((await (await download).path()) as string, 'latin1');
  expect(text).not.toMatch(/FILE_SCHEMA\s*\(\s*\(\s*'AP242/);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('pmi-report')).toHaveCount(0);
});

test('STEP import of a NIST PMI model: geometry in, the report lists the PMI not read', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const gz = fileURLToPath(
    new URL(
      '../../../packages/test-fixtures/step/nist/nist_ctc_01_asme1_ap242-e1.stp.gz',
      import.meta.url,
    ),
  );
  const buffer = gunzipSync(readFileSync(gz));
  await boot(page);
  await app(page).idle();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open or import…' }).click();
  await (await chooser).setFiles({
    name: 'nist_ctc_01_asme1_ap242-e1.stp',
    mimeType: 'application/step',
    buffer,
  });
  const report = page.getByTestId('pmi-report');
  // FACADE-PMI-PENDING: once the façade reads PMI this becomes "Imported N annotations …".
  await expect(report.getByTestId('pmi-report-title')).toHaveText(
    /nist_ctc_01_asme1_ap242-e1\.stp has model dimensions and tolerances \(PMI\) that were not imported|Imported \d+ annotations? from nist_ctc_01/,
    { timeout: 90_000 },
  );
  await app(page).idle();
  const r = await app(page).regen();
  expect(r?.features.at(-1)?.state).toBe('ok');
  expect(r?.bodies.length).toBeGreaterThan(0);
});
