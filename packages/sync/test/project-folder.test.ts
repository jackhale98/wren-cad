import { projectCodec, ulid } from '@wren-cad/document';
import { describe, expect, it } from 'vitest';
import { planProjectFolder, writeProjectFolder } from '../src/project-folder';
import { FolderProvider } from '../src/providers/folder';
import { FakeDir } from './support/fake-dir';
import { dec, must } from './support/fetch';
import { makeDoc as bareDoc, filesOf, withParam } from './support/project';

/** A saved document always has a library id. */
const makeDoc = () => {
  const d = bareDoc();
  d.meta.id = ulid();
  return d;
};

const enc = (s: string) => new TextEncoder().encode(s);

function paths(d: FakeDir, prefix = ''): string[] {
  const out: string[] = [];
  for (const [n, c] of d.children) {
    if (c instanceof FakeDir) out.push(...paths(c, `${prefix}${n}/`));
    else out.push(`${prefix}${n}`);
  }
  return out.sort();
}
const snapshot = async (d: FakeDir) =>
  Object.fromEntries(await Promise.all(paths(d).map(async (p) => [p, await d.text(`/${p}`)])));

describe('planProjectFolder', () => {
  const files = filesOf(makeDoc());
  const manifest = files.get('wren.project.json') as Uint8Array;

  it('writes everything into an empty folder, the manifest last', () => {
    const plan = planProjectFolder({ paths: [] }, files);
    if (!('ok' in plan)) throw new Error(plan.message);
    expect(plan.writes.map((w) => w.path).at(-1)).toBe('wren.project.json');
    expect(plan.writes).toHaveLength(files.size);
    expect(plan.deletes).toEqual([]);
  });

  it('writes the canonical bytes: LF, trailing newline', () => {
    const plan = planProjectFolder({ paths: [] }, files);
    if (!('ok' in plan)) throw new Error(plan.message);
    for (const w of plan.writes) {
      const text = dec(w.bytes);
      expect(text.endsWith('}\n')).toBe(true);
      expect(text).not.toContain('\r');
    }
  });

  it('removes stale project files of the same project and nothing else', () => {
    const plan = planProjectFolder(
      {
        paths: [
          'wren.project.json',
          'params.json',
          'parts/old-name.part.json',
          'imports/F1.step',
          'previews/bracket.stl',
          'releases/rev-a/x.step',
          'README.md',
        ],
        manifest,
      },
      files,
    );
    if (!('ok' in plan)) throw new Error(plan.message);
    expect(plan.deletes).toEqual(['imports/F1.step', 'parts/old-name.part.json']);
  });

  it('refuses a folder with a different project', () => {
    const other = filesOf(makeDoc()).get('wren.project.json');
    const r = planProjectFolder({ paths: ['wren.project.json'], manifest: other }, files);
    expect('code' in r && r.code).toBe('OTHER_PROJECT');
  });

  it('refuses an unreadable manifest and foreign files at the paths it would write', () => {
    const bad = planProjectFolder({ paths: ['wren.project.json'], manifest: enc('{nope') }, files);
    expect('code' in bad && bad.code).toBe('UNREADABLE_MANIFEST');
    const foreign = planProjectFolder({ paths: ['params.json', 'notes.txt'] }, files);
    expect('code' in foreign && foreign.code).toBe('FOREIGN_FILES');
  });

  it('refuses unsafe paths', () => {
    const bad = new Map([
      ['../x', enc('1')],
      ['.git/config', enc('1')],
    ]);
    const r = planProjectFolder({ paths: [] }, bad);
    expect('code' in r && r.code).toBe('UNSAFE_PATH');
  });
});

describe('writeProjectFolder', () => {
  it('round-trips through the folder provider to an identical document', async () => {
    const doc = makeDoc();
    const dir = new FakeDir('Bracket');
    expect((await writeProjectFolder(dir, filesOf(doc))).ok).toBe(true);
    const provider = new FolderProvider(dir);
    const listing = must(await provider.list({ path: '' }));
    const back = new Map<string, Uint8Array>();
    for (const e of listing.entries) {
      back.set(e.path.replace(/^\//, ''), must(await provider.read(e.path)).bytes);
    }
    expect(projectCodec.fromFiles(back)).toEqual(doc);
  });

  it('writes identical bytes when saved twice, and leaves them alone the second time', async () => {
    const doc = makeDoc();
    const dir = new FakeDir();
    await writeProjectFolder(dir, filesOf(doc));
    const first = await snapshot(dir);
    const again = await writeProjectFolder(dir, filesOf(doc));
    expect(again).toMatchObject({ ok: true, written: 0, removed: [] });
    expect(await snapshot(dir)).toEqual(first);
    const other = new FakeDir();
    await writeProjectFolder(other, filesOf(doc));
    expect(await snapshot(other)).toEqual(first);
  });

  it('removes the stale file when a part is renamed, and keeps other files', async () => {
    const doc = makeDoc();
    const dir = new FakeDir();
    await dir.put('/.git/HEAD', 'ref: refs/heads/main\n');
    await dir.put('/README.md', 'mine');
    await dir.put('/.wren-history/x.json', '{}');
    await writeProjectFolder(dir, filesOf(doc));
    expect(paths(dir)).toContain('parts/bracket.part.json');
    const renamed = structuredClone(doc);
    (renamed.parts[0] as { name: string }).name = 'Housing';
    const r = await writeProjectFolder(dir, filesOf(renamed));
    expect(r).toMatchObject({ ok: true, removed: ['parts/bracket.part.json'] });
    const now = paths(dir);
    expect(now).toContain('parts/housing.part.json');
    expect(now).not.toContain('parts/bracket.part.json');
    expect(await dir.text('/README.md')).toBe('mine');
    expect(await dir.text('/.git/HEAD')).toBe('ref: refs/heads/main\n');
    expect(await dir.text('/.wren-history/x.json')).toBe('{}');
    const edited = withParam(renamed, 'width', '50 mm');
    expect((await writeProjectFolder(dir, filesOf(edited))).ok).toBe(true);
  });

  it('refuses a folder with a different project and changes nothing', async () => {
    const dir = new FakeDir();
    await writeProjectFolder(dir, filesOf(makeDoc()));
    const before = await snapshot(dir);
    const r = await writeProjectFolder(dir, filesOf(makeDoc()));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('OTHER_PROJECT');
    expect(await snapshot(dir)).toEqual(before);
  });

  it('drops a folder it emptied (imports/) but keeps unrelated folders', async () => {
    const doc = makeDoc();
    const files = filesOf(doc);
    files.set('imports/F1.step', enc('step'));
    const dir = new FakeDir();
    await dir.put('/docs/a.md', 'a');
    await writeProjectFolder(dir, files);
    expect(paths(dir)).toContain('imports/F1.step');
    await writeProjectFolder(dir, filesOf(doc));
    expect(paths(dir).some((p) => p.startsWith('imports/'))).toBe(false);
    expect(paths(dir)).toContain('docs/a.md');
  });
});
