#!/usr/bin/env node
// A job that calls a reusable workflow must grant every permission the called workflow's jobs
// ask for. If it does not, GitHub refuses to start the run (`startup_failure`) and nothing in the
// run can report it: the nightly Soak failed that way for twelve days (ADR-102, Phase 0).
// Usage: node scripts/check-workflow-permissions.mjs [workflows dir]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const dir = process.argv[2] ?? '.github/workflows';
const LEVEL = { none: 0, read: 1, write: 2 };

/** `permissions:` as a map; `read-all` / `write-all` cover every scope. */
function normalise(p) {
  if (p === undefined || p === null) return null;
  if (p === 'read-all') return { '*': 'read' };
  if (p === 'write-all') return { '*': 'write' };
  return p;
}
const level = (perms, scope) => LEVEL[perms[scope] ?? perms['*'] ?? 'none'] ?? 0;

const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
const workflows = new Map(files.map((f) => [f, parse(readFileSync(join(dir, f), 'utf8'))]));
const problems = [];

for (const [file, wf] of workflows) {
  for (const [jobId, job] of Object.entries(wf?.jobs ?? {})) {
    const uses = typeof job?.uses === 'string' ? job.uses : '';
    const m = /^\.\/\.github\/workflows\/([^@]+)$/.exec(uses);
    if (!m) continue;
    const called = workflows.get(m[1]);
    if (!called) {
      problems.push(`${file}: job "${jobId}" calls ${m[1]}, which does not exist`);
      continue;
    }
    // No `permissions` on the job or its workflow: the repository default applies, which this
    // script cannot see. Every workflow here sets them, so treat a missing block as a problem.
    const granted = normalise(job.permissions) ?? normalise(wf.permissions);
    if (!granted) {
      problems.push(`${file}: job "${jobId}" calls ${m[1]} with no permissions block to check`);
      continue;
    }
    for (const [calledId, calledJob] of Object.entries(called?.jobs ?? {})) {
      const needs = normalise(calledJob?.permissions) ?? normalise(called.permissions) ?? {};
      for (const [scope, want] of Object.entries(needs)) {
        if (
          scope === '*' ? level(granted, '*') < LEVEL[want] : level(granted, scope) < LEVEL[want]
        ) {
          problems.push(
            `${file}: job "${jobId}" grants ${scope}: ${granted[scope] ?? granted['*'] ?? 'none'}, ` +
              `but ${m[1]} job "${calledId}" asks for ${scope}: ${want}. The run would fail at startup.`,
          );
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `workflow permissions: ${files.length} workflows checked, callers grant what they call`,
);
