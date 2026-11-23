/**
 * ADR-101: code asks a capability, not a device name. Only the detection (`diagnostics.ts`) and the
 * policy table (`tier-policy.ts`) may compare a tier with a tier name ('desktop', 'tablet',
 * 'phone'), switch on one, or index a table by `tier`. Hardware facts (memory, mesh, kernel boot,
 * pen, timeouts) are keyed by tier inside `policyFor`; layout and permission use `capabilitiesFor`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const ALLOWED = new Set([
  'apps/web/src/platform/diagnostics.ts',
  'apps/web/src/platform/tier-policy.ts',
]);
const NAME = `['"](?:desktop|tablet|phone)['"]`;
const BRANCH = new RegExp(
  [
    `(?:===|!==|==|!=)\\s*${NAME}`, // tier === 'desktop', tier !== 'tablet'
    `${NAME}\\s*(?:===|!==|==|!=)`, // 'phone' === tier
    `case\\s+${NAME}`, // switch (tier) { case 'phone': }
    `\\[\\s*(?:[\\w$]+\\??\\.)*tier\\s*\\]`, // { desktop: 1, phone: 2 }[wb.tier]
    `\\.includes\\(\\s*(?:[\\w$]+\\.)*tier\\s*\\)`, // ['tablet', 'phone'].includes(tier)
  ].join('|'),
);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no per-device branches', () => {
  it('nothing outside detection and policy compares, switches on or indexes by a tier', () => {
    const hits: string[] = [];
    for (const dir of ['apps/web/src', 'packages/ui/src'])
      for (const f of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, f);
        if (ALLOWED.has(rel)) continue;
        readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (BRANCH.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          });
      }
    expect(hits).toEqual([]);
  });

  it('the guard catches every form it is meant to', () => {
    for (const line of [
      "if (tier === 'desktop') a();",
      "const t = wb.tier !== 'tablet';",
      "x = 'phone' == tier;",
      "case 'phone':",
      '({ desktop: 1, tablet: 2, phone: 3 } as const)[wb.tier]',
      "['tablet', 'phone'].includes(wb.tier)",
    ])
      expect(BRANCH.test(line), line).toBe(true);
    for (const line of ["const x = 'desktop';", 'wb.policy.penDraws', 'tiers[i]'])
      expect(BRANCH.test(line), line).toBe(false);
  });
});
