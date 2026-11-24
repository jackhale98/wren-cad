/**
 * Change preview (ADR-103, slice 2e.2), reviewer 2026-11-24: previewing a feature that makes its
 * own body must not leave a coarser mesh on that body. `meshOf` keeps one mesh per shape and
 * quality, so a preview meshed at the largest final body's deflection was what a later rollback to
 * that state showed. Real kernel.
 */
import type { Feature, WrenDoc } from '@wren-cad/contracts';
import { beforeAll, expect, it } from 'vitest';
import { type Api, extrude, fid, loadApi, makeDoc, region, Sk } from './helpers';

const PART = fid('PART');
const A = fid('PVA');
const AE = fid('PVAE');
const B = fid('PVB');
const BE = fid('PVBE');
let api: Api;
beforeAll(async () => {
  api = await loadApi();
}, 60_000);

/** A small cylinder (new body, 10 mm), then a 200 mm boss added to it. */
function doc(rollback?: number): WrenDoc {
  const s = new Sk();
  s.circle('C', 0, 0, 4);
  s.geo({ kind: 'fix', entity: 'Cc' });
  s.dim({ kind: 'radius', curve: 'C' }, '4');
  const t = new Sk();
  t.circle('D', 0, 0, 2);
  t.geo({ kind: 'fix', entity: 'Dc' });
  t.dim({ kind: 'radius', curve: 'D' }, '2');
  const feats: Feature[] = [
    s.feature(A),
    extrude(AE, [region(A, 'C')], '10'),
    t.feature(B),
    extrude(BE, [region(B, 'D')], '200', 'add'),
  ];
  const d = makeDoc({}, feats);
  if (rollback !== undefined) (d.parts[0] as { rollbackIndex: number }).rollbackIndex = rollback;
  return d;
}

const run = (d: WrenDoc, preview?: string) =>
  api.regenerate({
    doc: d,
    partId: PART,
    slot: 'main',
    quality: 'coarse',
    ...(preview ? { preview: { featureId: preview } } : {}),
  });

it('a rollback after previewing an own-body feature shows the same mesh as without the preview', async () => {
  const full = await run(doc(), AE);
  expect(full.preview?.shows).toBe('tool');
  const afterPreview = (await run(doc(2))).bodies[0]?.mesh.indices.length;
  await api.closePart(PART);
  await run(doc());
  const never = (await run(doc(2))).bodies[0]?.mesh.indices.length;
  expect(afterPreview).toBeGreaterThan(0);
  expect(afterPreview).toBe(never);
});
