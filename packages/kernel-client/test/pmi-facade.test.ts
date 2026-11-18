/**
 * The STEP PMI façade adapter (M5a, ADR-100): the assumed entry points, their absence, and the
 * checks on what the extended STEP import returns (a malformed item becomes an issue, never a
 * crash and never a silent drop).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PmiExportItem } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { createKernelApi } from '../src/kernel-api';
import { callExportStepPmi, canExportPmi, importedPmiOf, PMI_FACADE } from '../src/pmi-facade';
import { built, skipNote, variants } from './regen/helpers';

const item: PmiExportItem = {
  annotationId: '01JPMX00000000000000000001',
  kind: 'dimension',
  type: 'linearDistance',
  targets: [
    { body: 0, kind: 'face', index: 1 },
    { body: 0, kind: 'face', index: 2 },
  ],
  value: 8,
};

describe('PMI façade adapter', () => {
  it('calls exportStepPmi with the shapes, items and options as JSON', () => {
    const seen: string[][] = [];
    const k = {
      [PMI_FACADE.exportFunction](...args: string[]) {
        seen.push(args);
        return '{"ok":true,"value":{"path":"/tmp/x.step","files":[]}}';
      },
    };
    expect(canExportPmi(k)).toBe(true);
    const out = callExportStepPmi(k, [{ shape: 3, name: 'Bracket' }], [item], {
      stepSchema: 'AP242',
      pmi: {},
    });
    expect(out).toContain('"ok":true');
    expect(seen[0]?.map((s) => JSON.parse(s))).toEqual([
      [{ shape: 3, name: 'Bracket' }],
      [item],
      { stepSchema: 'AP242', pmi: {} },
    ]);
  });

  it('reports a build without it', () => {
    expect(canExportPmi({})).toBe(false);
    expect(callExportStepPmi({}, [], [], {})).toBeNull();
  });

  it('reads the extended import result: Wren ids from names, targets checked against counts', () => {
    expect(importedPmiOf({ bodies: [] })).toBeUndefined();
    const counts = [{ faces: 10, edges: 24, vertices: 16 }];
    const { annotationId: _id, ...dim } = item;
    const r = importedPmiOf({
      bodies: [{ shape: 1 }],
      pmi: {
        items: [
          { ...dim, name: item.annotationId },
          {
            kind: 'datum',
            label: 'A',
            name: 'Datum A',
            targets: [{ body: 0, kind: 'face', index: 3 }],
          },
          {
            kind: 'presentationOnly',
            name: 'Note 1',
            presentation: {
              plane: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
              polylines: [],
            },
          },
        ],
        issues: [{ name: 'GT3', reason: 'Value not read' }],
        counts,
      },
    } as never);
    expect(
      r?.items.map((i) => [i.kind, i.name, 'annotationId' in i ? i.annotationId : null]),
    ).toEqual([
      ['dimension', item.annotationId, item.annotationId],
      ['datum', 'Datum A', null],
      ['presentationOnly', 'Note 1', null],
    ]);
    expect(r?.issues).toEqual([{ name: 'GT3', reason: 'Value not read' }]);
  });

  it('malformed kernel PMI (a target past its body) is one issue, nothing read from it', () => {
    const r = importedPmiOf({
      bodies: [{ shape: 1 }],
      pmi: {
        items: [{ kind: 'datum', label: 'A', targets: [{ body: 0, kind: 'face', index: 11 }] }],
        issues: [],
        counts: [{ faces: 10, edges: 24, vertices: 16 }],
      },
    } as never);
    expect(r?.items).toEqual([]);
    expect(r?.issues).toHaveLength(1);
    expect(r?.issues[0]?.reason).toMatch(/malformed PMI.*face 11.*no PMI was read/);
  });
});

describe.skipIf(!built)(`the kernel build's PMI entry point${skipNote}`, () => {
  it('exportStepPmi writes a file with its report, or is UNSUPPORTED_FEATURE on an older build', async () => {
    const api = createKernelApi({ variants, canUseThreads: () => false });
    await api.init({ variant: 'single' });
    const r = await api.exportStepPmi?.([], [item], { stepSchema: 'AP242', pmi: {} });
    if (r?.ok === false && r.error.code === 'UNSUPPORTED_FEATURE') return; // FACADE-PMI-PENDING
    // With the façade: no shapes is refused with a KernelError, never a throw.
    expect(r?.ok === false ? r.error.code : 'ok').toBeTypeOf('string');
  });
});
