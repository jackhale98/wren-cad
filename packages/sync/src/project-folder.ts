// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Save as project folder" (ADR-101 amendment): the canonical project files written into a folder
 * the user picked, so a project kept in git can be diffed and merged (a `.wrencad` is a zip).
 *
 * `planProjectFolder` is pure: an existing listing plus the new files give the writes, the
 * deletes or a refusal. `writeProjectFolder` is the thin File System Access half. Rules:
 *  - project files are replaced; the only files ever removed are those the folder's *own*
 *    manifest names (parts, drawings, assemblies) and the new save no longer has. A file Wren
 *    cannot prove it wrote (an attachment under `imports/`, a note someone added) is never
 *    removed, so a stale attachment can stay behind;
 *  - a folder whose manifest has another project id, or (no manifest) files at paths the save
 *    would write, is refused unless the caller passes `replace` (the user said so, inline). An
 *    id differs for a different project, but also for the same project opened from a folder or
 *    a clone, which gets a new library id on each device; so the refusal names the project
 *    found and is replaceable. An unreadable manifest is always refused;
 *  - never written, read or deleted: `.git/`, `.wren/` (cache), `.wren-history/`.
 */

import type { ProjectFiles } from '@wren-cad/contracts';
import { MANIFEST_FILE, PARAMS_FILE } from '@wren-cad/document';
import { manifestRefs } from './paths';
import type { FolderFileHandle, FolderHandle } from './providers/folder';

/** Folders a save looks into (and nowhere else): the document's folders and its attachments. */
const PROJECT_DIRS = ['parts', 'drawings', 'assemblies', 'imports', 'previews', 'releases'];
/** Of these, the folders whose files a later save may remove when the project no longer has them. */
const OWNED_DIRS = ['parts', 'drawings', 'assemblies'];

export type FolderRefusal =
  /** `replaceable`: the same save with `replace: true` goes through. `name`: the project found. */
  | { code: 'OTHER_PROJECT'; message: string; replaceable: true; name?: string }
  | { code: 'UNREADABLE_MANIFEST'; message: string }
  | { code: 'FOREIGN_FILES'; message: string; paths: string[]; replaceable: true }
  | { code: 'UNSAFE_PATH'; message: string; paths: string[] };

export interface FolderPlan {
  ok: true;
  /** Files to write: the manifest last, so a reader never sees it before the files it names. */
  writes: { path: string; bytes: Uint8Array }[];
  /** Stale files of an earlier save of this project. */
  deletes: string[];
}

export interface ExistingFolder {
  /** Project-relative paths of the files already there, within the project's own folders. */
  paths: readonly string[];
  /** Bytes of `wren.project.json`, when there is one. */
  manifest?: Uint8Array | null;
}

const safe = (p: string): boolean =>
  p !== '' &&
  !p.startsWith('/') &&
  !p.includes('\\') &&
  !p.split('/').some((s) => s === '' || s === '.' || s === '..') &&
  !/^\.(git|wren|whittle|wren-history)(\/|$)/.test(p);

const isModelFile = (p: string): boolean => /^(parts|drawings|assemblies)\/[^/]+\.json$/.test(p);

function projectIdentity(
  bytes: Uint8Array | null | undefined,
): { id: string | null; name?: string } | 'unreadable' {
  if (!bytes) return { id: null };
  try {
    const m = JSON.parse(new TextDecoder().decode(bytes)) as {
      meta?: { id?: unknown; name?: unknown };
    } | null;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return 'unreadable';
    const id = typeof m.meta?.id === 'string' && m.meta.id !== '' ? m.meta.id : null;
    return typeof m.meta?.name === 'string' && m.meta.name !== ''
      ? { id, name: m.meta.name }
      : { id };
  } catch {
    return 'unreadable';
  }
}

export interface FolderPlanOptions {
  /** The user chose to replace what the folder holds (another project id, or clashing files). */
  replace?: boolean;
}

/** Orders writes: referenced files, then params, the manifest last. */
const rank = (p: string): number => (p === MANIFEST_FILE ? 2 : p === PARAMS_FILE ? 1 : 0);

export function planProjectFolder(
  existing: ExistingFolder,
  files: ProjectFiles,
  options: FolderPlanOptions = {},
): FolderPlan | FolderRefusal {
  const bad = [...files.keys()].filter((p) => !safe(p));
  if (bad.length) {
    return {
      code: 'UNSAFE_PATH',
      message: `These paths are not allowed: ${bad.join(', ')}`,
      paths: bad,
    };
  }
  const have = new Set(existing.paths);
  const hasManifest = have.has(MANIFEST_FILE);
  const nextManifest = files.get(MANIFEST_FILE);
  if (hasManifest) {
    const theirs = projectIdentity(existing.manifest);
    const ours = projectIdentity(nextManifest);
    if (theirs === 'unreadable') {
      return {
        code: 'UNREADABLE_MANIFEST',
        message: `This folder has a ${MANIFEST_FILE} that Wren cannot read, so it was left alone. Pick an empty folder.`,
      };
    }
    const same =
      ours !== 'unreadable' && ours.id !== null && theirs.id !== null && ours.id === theirs.id;
    if (!same && !options.replace) {
      const found = theirs.name ? `the Wren project “${theirs.name}”` : 'a Wren project';
      return {
        code: 'OTHER_PROJECT',
        message: `This folder already holds ${found}, saved from another copy, so nothing was written. Replace it if it is this project; otherwise pick another folder.`,
        replaceable: true,
        ...(theirs.name ? { name: theirs.name } : {}),
      };
    }
  } else if (!options.replace) {
    // Not a Wren project: files the save would overwrite are someone else's.
    const clash = [...files.keys()].filter((p) => have.has(p)).sort();
    if (clash.length) {
      return {
        code: 'FOREIGN_FILES',
        message: `This folder is not a Wren project but already has ${clash.slice(0, 3).join(', ')}${clash.length > 3 ? ' and more' : ''}, so nothing was written. Replace those files, or pick an empty folder.`,
        paths: clash,
        replaceable: true,
      };
    }
  }
  const writes = [...files]
    .map(([path, bytes]) => ({ path, bytes }))
    .sort(
      (a, b) => rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
  // Only what the folder's own manifest names: Wren wrote those. Nothing else is ever removed.
  const deletes = hasManifest
    ? [...new Set(manifestRefs(existing.manifest))]
        .filter((p) => have.has(p) && !files.has(p) && isModelFile(p) && safe(p))
        .sort()
    : [];
  return { ok: true, writes, deletes };
}

const split = (path: string): { dir: string[]; name: string } => {
  const p = path.split('/');
  return { name: p.pop() as string, dir: p };
};

async function dirAt(root: FolderHandle, dir: string[], create: boolean): Promise<FolderHandle> {
  let d = root;
  for (const n of dir) d = await d.getDirectoryHandle(n, { create });
  return d;
}

const notFound = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'NotFoundError';

/** Paths (relative to `root`) of the files in the project's own folders, and the manifest bytes. */
export async function listProjectFolder(root: FolderHandle): Promise<ExistingFolder> {
  const paths: string[] = [];
  let manifest: Uint8Array | null = null;
  for await (const h of root.values()) {
    if (h.kind === 'file') {
      paths.push(h.name);
      if (h.name === MANIFEST_FILE) {
        manifest = new Uint8Array(await (await h.getFile()).arrayBuffer());
      }
    }
  }
  const walk = async (dir: FolderHandle, prefix: string): Promise<void> => {
    for await (const h of dir.values()) {
      if (h.kind === 'directory') await walk(h, `${prefix}${h.name}/`);
      else paths.push(`${prefix}${h.name}`);
    }
  };
  for (const name of PROJECT_DIRS) {
    try {
      await walk(await root.getDirectoryHandle(name), `${name}/`);
    } catch (e) {
      if (!notFound(e)) throw e;
    }
  }
  return { paths, manifest };
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export interface FolderSaveResult {
  written: number;
  /** Files already identical on disk (left alone, so their modified time and git status stay). */
  unchanged: number;
  removed: string[];
}

export type FolderSaveOutcome =
  | ({ ok: true } & FolderSaveResult)
  | { ok: false; refusal: FolderRefusal }
  | { ok: false; refusal: { code: 'WRITE_FAILED'; message: string } };

/** Lists, plans and writes. Identical files are not rewritten. */
export async function writeProjectFolder(
  root: FolderHandle,
  files: ProjectFiles,
  options: FolderPlanOptions = {},
): Promise<FolderSaveOutcome> {
  try {
    const plan = planProjectFolder(await listProjectFolder(root), files, options);
    if (!('ok' in plan)) return { ok: false, refusal: plan };
    let written = 0;
    let unchanged = 0;
    for (const w of plan.writes) {
      const { dir, name } = split(w.path);
      const d = await dirAt(root, dir, true);
      let h: FolderFileHandle | null = null;
      try {
        h = await d.getFileHandle(name);
        const cur = new Uint8Array(await (await h.getFile()).arrayBuffer());
        if (sameBytes(cur, w.bytes)) {
          unchanged++;
          continue;
        }
      } catch (e) {
        if (!notFound(e)) throw e;
        h = null;
      }
      h ??= await d.getFileHandle(name, { create: true });
      const out = await h.createWritable();
      try {
        await out.write(w.bytes);
        await out.close();
      } catch (e) {
        await out.abort?.().catch(() => undefined);
        throw e;
      }
      written++;
    }
    const removed: string[] = [];
    for (const p of plan.deletes) {
      const { dir, name } = split(p);
      try {
        await (await dirAt(root, dir, false)).removeEntry(name);
        removed.push(p);
      } catch (e) {
        if (!notFound(e)) throw e;
      }
    }
    // A folder this save emptied goes with its last file (never a folder it did not empty).
    for (const name of OWNED_DIRS) {
      if (!removed.some((p) => p.startsWith(`${name}/`))) continue;
      try {
        const d = await root.getDirectoryHandle(name);
        let empty = true;
        for await (const _ of d.values()) {
          empty = false;
          break;
        }
        if (empty) await root.removeEntry(name);
      } catch {
        /* leave it */
      }
    }
    return { ok: true, written, unchanged, removed };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    const message =
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Wren no longer has access to that folder. Pick it again.'
        : name === 'QuotaExceededError'
          ? 'The disk is full.'
          : `The folder could not be written: ${(e as Error)?.message ?? 'unknown error'}`;
    return { ok: false, refusal: { code: 'WRITE_FAILED', message } };
  }
}
