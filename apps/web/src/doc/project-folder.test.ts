import { newDoc, newPart, projectCodec, ulid } from '@wren-cad/document';
import { describe, expect, it } from 'vitest';
import { folderFiles } from './project-folder';

const enc = (s: string) => new TextEncoder().encode(s);

describe('folderFiles', () => {
  const doc = newDoc({ name: 'Bracket' });
  doc.meta.id = ulid();
  doc.parts = [newPart('Bracket')];

  it('is the same bytes the .wrencad holds, plus attachments', () => {
    const extra = new Map([['imports/F1.step', enc('ISO-10303')]]);
    const files = folderFiles(doc, extra);
    for (const [path, bytes] of projectCodec.toFiles(doc)) expect(files.get(path)).toEqual(bytes);
    expect(files.get('imports/F1.step')).toEqual(enc('ISO-10303'));
  });

  it('never carries the cache or the snapshot history', () => {
    const extra = new Map([
      ['.wren-history/versions/a.json', enc('{}')],
      ['.wren/meshes/index.json', enc('{}')],
      ['previews/bracket.stl', enc('solid')],
    ]);
    const paths = [...folderFiles(doc, extra).keys()];
    expect(paths.some((p) => p.startsWith('.wren'))).toBe(false);
    expect(paths).toContain('previews/bracket.stl');
  });

  it('is deterministic', () => {
    const a = folderFiles(doc, new Map());
    const b = folderFiles(structuredClone(doc), new Map());
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [k, v] of a) expect(b.get(k)).toEqual(v);
  });
});
