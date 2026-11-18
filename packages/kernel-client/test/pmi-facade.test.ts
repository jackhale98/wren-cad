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

  it('reads the extended import result, turning malformed items into issues', () => {
    expect(importedPmiOf({ bodies: [] })).toBeUndefined();
    const r = importedPmiOf({
      bodies: [{ shape: 1 }],
      pmi: {
        items: [
          { ...item, name: 'D1' },
          { kind: 'datum', label: 'A', name: 'DA', targets: [{ body: 0, kind: 'face', index: 0 }] },
          { kind: 'mystery', name: 'X' },
          { kind: 'presentationOnly', name: 'P', presentation: { plane: {}, polylines: [] } },
          { kind: 'presentationOnly', name: 'Q' },
        ],
        issues: [{ name: 'GT3', reason: 'Value not read' }, {}],
      },
    } as never);
    expect(r?.items.map((i) => i.name)).toEqual(['D1', 'P']);
    expect(r?.issues).toEqual([
      { name: 'GT3', reason: 'Value not read' },
      { reason: 'Unreadable entity' },
      { name: 'DA', reason: 'Its model geometry is not given as body sub-shapes' },
      { name: 'X', reason: 'Unknown PMI kind "mystery"' },
      { name: 'Q', reason: 'Presentation without geometry' },
    ]);
  });
});

describe.skipIf(!built)(`kernel build without the PMI entry points${skipNote}`, () => {
  it('exportStepPmi is UNSUPPORTED_FEATURE until the façade has it', async () => {
    const api = createKernelApi({ variants, canUseThreads: () => false });
    await api.init({ variant: 'single' });
    const r = await api.exportStepPmi?.([], [item], { stepSchema: 'AP242', pmi: {} });
    // FACADE-PMI-PENDING: flips once the kernel build binds exportStepPmi.
    expect(r?.ok === false && r.error.code).toBe('UNSUPPORTED_FEATURE');
  });
});
