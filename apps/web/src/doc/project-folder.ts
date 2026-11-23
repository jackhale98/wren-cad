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
  /** `replaceable`: `saveProjectFolder(files, { replace: true })` writes into the same folder. */
  | { kind: 'refused'; message: string; replaceable?: boolean };

/** The folder of the last refusal that the user may still choose to replace. */
let pending: unknown = null;

/**
 * Asks for a folder and writes the project into it. With `replace`, writes into the folder the
 * last save refused (no second picker) and replaces what it holds. Throws nothing the user could
 * act on. The picker is the first thing awaited, so the click's user activation is still live.
 */
export async function saveProjectFolder(
  files: ProjectFiles,
  options: { replace?: boolean } = {},
): Promise<FolderSave> {
  let handle: unknown = options.replace ? pending : null;
  pending = null;
  if (!handle) {
    if (options.replace) return { kind: 'refused', message: 'Pick the folder again.' };
    const w = globalThis as unknown as DirectoryPicker;
    if (typeof w.showDirectoryPicker !== 'function') {
      return { kind: 'refused', message: 'This browser cannot save to a folder.' };
    }
    try {
      handle = await w.showDirectoryPicker({ mode: 'readwrite', id: 'wren-project-folder' });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return { kind: 'cancelled' };
      return { kind: 'refused', message: 'Wren could not open that folder.' };
    }
  }
  const { writeProjectFolder } = await import('@wren-cad/sync/project-folder');
  const dir = handle as Parameters<typeof writeProjectFolder>[0];
  const r = await writeProjectFolder(dir, files, options.replace ? { replace: true } : {});
  if (!r.ok) {
    const replaceable = 'replaceable' in r.refusal && r.refusal.replaceable === true;
    if (replaceable) pending = handle;
    return { kind: 'refused', message: r.refusal.message, ...(replaceable ? { replaceable } : {}) };
  }
  return {
    kind: 'saved',
    folder: dir.name,
    written: r.written,
    unchanged: r.unchanged,
    removed: r.removed.length,
  };
}
