import { describe, expect, it } from 'vitest';
import {
  folderPickerSupported,
  gitNoticeSilenced,
  isGitProject,
  showGitNotice,
  silenceGitNotice,
} from './folder-notice';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe('git notice', () => {
  it('knows git projects only from the connection kind', () => {
    expect(isGitProject('git')).toBe(true);
    expect(isGitProject('localGit')).toBe(true);
    for (const k of ['local', 'file', '']) expect(isGitProject(k)).toBe(false);
  });

  it('is offered for a git project with a directory picker, until silenced', () => {
    const on = { projectKind: 'git', supported: true, silenced: false };
    expect(showGitNotice(on)).toBe(true);
    expect(showGitNotice({ ...on, silenced: true })).toBe(false);
    expect(showGitNotice({ ...on, supported: false })).toBe(false);
    expect(showGitNotice({ ...on, projectKind: 'file' })).toBe(false);
  });

  it('"don\'t show again" persists', () => {
    const s = memory();
    expect(gitNoticeSilenced(s)).toBe(false);
    silenceGitNotice(s);
    expect(gitNoticeSilenced(s)).toBe(true);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(gitNoticeSilenced(broken)).toBe(false);
    expect(() => silenceGitNotice(broken)).not.toThrow();
  });

  it('detects the directory picker', () => {
    expect(folderPickerSupported({})).toBe(false);
    expect(folderPickerSupported({ showDirectoryPicker: () => undefined })).toBe(true);
  });
});
