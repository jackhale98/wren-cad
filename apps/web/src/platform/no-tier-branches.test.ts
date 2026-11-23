/**
 * ADR-101: code asks a capability, not a device name. Only the detection (`diagnostics.ts`) and the
 * policy table (`tier-policy.ts`) may compare a tier with 'phone'.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const ALLOWED = new Set([
  'apps/web/src/platform/diagnostics.ts',
  'apps/web/src/platform/tier-policy.ts',
]);
const BRANCH =
  /(?:===|!==|==|!=)\s*['"]phone['"]|['"]phone['"]\s*(?:===|!==|==|!=)|case\s+['"]phone['"]/;

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
  it("nothing outside detection and policy compares a tier with 'phone'", () => {
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
});
