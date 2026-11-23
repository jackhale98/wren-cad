/**
 * Save as project folder: the browser half. The canonical files are exactly what `projectCodec`
 * produces for the `.wrencad` (sorted keys, LF, trailing newline) plus the attachments; never the
 * `.wren/` cache or `.wren-history/` (a git repo is its own history). The planning and writing
 * are `@wren-cad/sync` (`writeProjectFolder`); this adds the picker.
 */

import type { ProjectFiles, WrenDoc } from '@wren-cad/contracts';
import { projectFiles } from '../sync/working-copy';

const NOT_PROJECT = /^(\.wren\/|\.whittle\/|\.wren-history\/|\.git\/)/;

/** The files a project folder holds for `doc` and its extra (attachment) files. */
export function folderFiles(doc: WrenDoc, extra: ProjectFiles): ProjectFiles {
  const files = projectFiles(doc, extra);
  for (const p of [...files.keys()]) if (NOT_PROJECT.test(p)) files.delete(p);
  return files;
}

interface DirectoryPicker {
  showDirectoryPicker?: (o?: { mode?: 'readwrite'; id?: string }) => Promise<unknown>;
}

export type FolderSave =
  | { kind: 'saved'; folder: string; written: number; unchanged: number; removed: number }
  | { kind: 'cancelled' }
  | { kind: 'refused'; message: string };

/** Asks for a folder and writes the project into it. Throws nothing the user could act on. */
export async function saveProjectFolder(files: ProjectFiles): Promise<FolderSave> {
  const w = globalThis as unknown as DirectoryPicker;
  if (typeof w.showDirectoryPicker !== 'function') {
    return { kind: 'refused', message: 'This browser cannot save to a folder.' };
  }
  let handle: unknown;
  try {
    handle = await w.showDirectoryPicker({ mode: 'readwrite', id: 'wren-project-folder' });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') return { kind: 'cancelled' };
    return { kind: 'refused', message: 'Wren could not open that folder.' };
  }
  const { writeProjectFolder } = await import('@wren-cad/sync/project-folder');
  const dir = handle as Parameters<typeof writeProjectFolder>[0];
  const r = await writeProjectFolder(dir, files);
  if (!r.ok) return { kind: 'refused', message: r.refusal.message };
  return {
    kind: 'saved',
    folder: dir.name,
    written: r.written,
    unchanged: r.unchanged,
    removed: r.removed.length,
  };
}
